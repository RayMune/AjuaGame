from flask import Flask, render_template, session, redirect, url_for, jsonify, request
from copy import deepcopy
import math
import boto3
import os
import traceback
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Hedera SDK for testnet transfers
from hedera import (
    Client,
    AccountId,
    PrivateKey,
    TransferTransaction,
    AccountBalanceQuery,
    Hbar,
)
import json
import base64

app = Flask(__name__)
app.secret_key = "ajua_secret_key"

# AWS Bedrock setup - load from environment
bedrock_client = boto3.client(
    service_name="bedrock-runtime",
    region_name="us-east-1"
)

# --- Load Hedera testnet account credentials from environment ---
MY_ACCOUNT_ID = AccountId.fromString(os.getenv("HEDERA_ACCOUNT_ID"))
MY_PRIVATE_KEY = PrivateKey.fromString(os.getenv("HEDERA_PRIVATE_KEY"))

# ---------------- Core Game ----------------
def new_board():
    return {"p1": [4, 4, 4, 4, 4, 4],
            "p2": [4, 4, 4, 4, 4, 4],
            "stores": {"p1": 0, "p2": 0}}

def valid_moves(board, player):
    return [i for i, v in enumerate(board[player]) if v > 0]

def sow(board, player, pit_index):
    pits, opp = ("p1", "p2") if player == "p1" else ("p2", "p1")
    stones = board[pits][pit_index]
    if stones == 0:
        return board, False
    board[pits][pit_index] = 0
    i, side = pit_index, pits

    while stones > 0:
        i += 1
        if side == pits and i == 6:
            board["stores"][player] += 1
            stones -= 1
            if stones == 0:
                return board, True  # free turn
            i, side = -1, opp
        elif side == opp and i == 6:
            i, side = -1, pits
        else:
            board[side][i] += 1
            stones -= 1
    return board, False

def check_winner(board):
    if board["stores"]["p1"] >= 10:
        return "You"
    elif board["stores"]["p2"] >= 10:
        return "Computer"
    return None

# ---------------- Minimax ----------------
def evaluate(board):
    return board["stores"]["p2"] - board["stores"]["p1"]

def minimax(board, depth, maximizing):
    winner = check_winner(board)
    if depth == 0 or winner:
        return evaluate(board), None

    player = "p2" if maximizing else "p1"
    moves = valid_moves(board, player)
    if not moves:
        return evaluate(board), None

    best_move = None
    if maximizing:
        best_val = -math.inf
        for m in moves:
            new_board, extra = sow(deepcopy(board), player, m)
            val, _ = minimax(new_board, depth - (0 if extra else 1), not extra)
            if val > best_val:
                best_val, best_move = val, m
        return best_val, best_move
    else:
        best_val = math.inf
        for m in moves:
            new_board, extra = sow(deepcopy(board), player, m)
            val, _ = minimax(new_board, depth - (0 if extra else 1), extra)
            if val < best_val:
                best_val, best_move = val, m
        return best_val, best_move

# ---------------- Flask Routes ----------------
@app.route("/")
def index():
    if "board" not in session:
        session["board"] = new_board()
        session["turn"] = "p1"
    winner = check_winner(session["board"])
    return render_template("index.html", board=session["board"], turn=session["turn"], winner=winner)

@app.route("/move/<int:pit>", methods=["POST"])
def move(pit):
    board, turn = deepcopy(session["board"]), session["turn"]

    if turn == "p1":
        if pit not in valid_moves(board, "p1"):
            return jsonify({"error": "Invalid move"}), 400
        board, extra = sow(board, "p1", pit)
        session["board"] = board
        if not extra:
            session["turn"] = "p2"

    ai_moves = []
    while session["turn"] == "p2" and not check_winner(board):
        _, ai_move = minimax(board, 4, True)
        if ai_move is None:
            break
        board, extra = sow(board, "p2", ai_move)
        ai_moves.append(ai_move)
        session["board"] = board
        if not extra:
            session["turn"] = "p1"

    session["board"] = board
    winner = check_winner(board)
    return jsonify({
        "board": session["board"],
        "turn": session["turn"],
        "winner": winner,
        "ai_moves": ai_moves
    })

@app.route("/reset")
def reset():
    session.clear()
    return redirect(url_for("index"))


@app.route('/claim', methods=['POST'])
def claim():
    """Receive a JSON payload with 'account_id' (string). Send 1 testnet HBAR from
    the hardcoded operator account to that account and return JSON with status and balances.
    """
    try:
        data = request.get_json() or {}
        to_account = data.get('account_id')
        if not to_account:
            return jsonify({'error': 'account_id is required'}), 400

        # Initialize Hedera client for Testnet and set operator
        client = Client.forTestnet()
        client.setOperator(MY_ACCOUNT_ID, MY_PRIVATE_KEY)

        # Read balance before transfer (tinybars)
        before = AccountBalanceQuery().setAccountId(MY_ACCOUNT_ID).execute(client).hbars.toTinybars()

        # Verify operator has >= 1 HBAR (1 HBAR = 100_000_000 tinybars)
        ONE_HBAR_TINYBARS = 100_000_000
        if before < ONE_HBAR_TINYBARS:
            msg = 'Operator account has insufficient balance to send 1 HBAR.'
            print(msg)
            return jsonify({'error': msg, 'before': before}), 400

        # Build a small JSON record of the game and encode as base64 for the transaction memo
        try:
            board = session.get('board', {})
            score = f"{board.get('stores', {}).get('p1', 0)}-{board.get('stores', {}).get('p2', 0)}"
            game_data = {
                "player_id": str(to_account),
                "opponent": "AI",
                "result": "win",
                "score": score,
            }
            memo = base64.b64encode(json.dumps(game_data).encode()).decode()[:100]
        except Exception:
            memo = None

        # Build and execute transfer (1 HBAR) and attach memo if available
        tx_builder = (
            TransferTransaction()
            .addHbarTransfer(MY_ACCOUNT_ID, Hbar(-1))
            .addHbarTransfer(AccountId.fromString(to_account), Hbar(1))
        )
        if memo:
            tx_builder = tx_builder.setTransactionMemo(memo)

        tx = tx_builder.execute(client)

        # Wait for receipt
        receipt = tx.getReceipt(client)

        after = AccountBalanceQuery().setAccountId(MY_ACCOUNT_ID).execute(client).hbars.toTinybars()

        message = f"✅ Sent 1 testnet HBAR to {to_account}. Transaction status: {receipt.status}"
        print(message)
        return jsonify({'message': message, 'before': before, 'after': after, 'status': str(receipt.status)})

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route("/chat", methods=["POST"])
def chat():
    try:
        data = request.get_json()
        user_message = data.get("message", "")
        
        if not user_message:
            return jsonify({"error": "No message provided"}), 400
        
        # Get conversation history from session
        if "chat_history" not in session:
            session["chat_history"] = []
        
        chat_history = session["chat_history"]
        
        # Add user message to history
        chat_history.append({"role": "user", "content": [{"text": user_message}]})
        
        # Call AWS Bedrock
        model_id = "us.anthropic.claude-3-5-haiku-20241022-v1:0"
        
        response = bedrock_client.converse(
            modelId=model_id,
            messages=chat_history,
            system=[{"text": "You are Ajua AI, a friendly assistant who loves the traditional African game of Mancala (also known as Ajua). You help players understand strategies, share cultural knowledge about the game, and engage in friendly conversation. Keep responses concise and warm. If it is not about Ajua or Mancali, do not speak about it."}]
        )
        
        # Extract AI response
        ai_message = response['output']['message']['content'][0]['text']
        
        # Add AI response to history
        chat_history.append({"role": "assistant", "content": [{"text": ai_message}]})
        
        # Keep only last 10 messages to avoid token limits
        if len(chat_history) > 10:
            chat_history = chat_history[-10:]
        
        session["chat_history"] = chat_history
        
        return jsonify({"response": ai_message})
        
    except Exception as e:
        print(f"Chat error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/clear_chat", methods=["POST"])
def clear_chat():
    session["chat_history"] = []
    return jsonify({"status": "cleared"})


if __name__ == "__main__":
    app.run(debug=True)
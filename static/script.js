class HashPackConnector {
    constructor() {
        this.provider = null;
        this.connectedAccount = null;
        this.isConnected = false;
        
        this.initializeElements();
        this.initializeEventListeners();
        this.checkHashPackAvailability();
    }

    initializeElements() {
        // Buttons
        this.connectButton = document.getElementById('connectButton');
        this.disconnectButton = document.getElementById('disconnectButton');
        this.getBalanceButton = document.getElementById('getBalanceButton');
        this.sendButton = document.getElementById('sendButton');
        
        // Status elements
        this.statusIndicator = document.getElementById('statusIndicator');
        this.networkValue = document.getElementById('networkValue');
        this.accountIdValue = document.getElementById('accountIdValue');
        this.balanceValue = document.getElementById('balanceValue');
        
        // Transaction elements
        this.transactionSection = document.getElementById('transactionSection');
        this.recipientInput = document.getElementById('recipient');
        this.amountInput = document.getElementById('amount');
        
        // Message container
        this.messageContainer = document.getElementById('messageContainer');
    }

    initializeEventListeners() {
        this.connectButton.addEventListener('click', () => this.connect());
        this.disconnectButton.addEventListener('click', () => this.disconnect());
        this.getBalanceButton.addEventListener('click', () => this.getBalance());
        this.sendButton.addEventListener('click', () => this.sendTransaction());
    }

    checkHashPackAvailability() {
        if (window.hedera) {
            this.provider = window.hedera;
            this.showMessage('HashPack wallet is available!', 'success');
        } else {
            this.showMessage('HashPack wallet not detected. Please install it.', 'error');
            this.connectButton.disabled = true;
            this.connectButton.innerHTML = '🚫 HashPack Not Installed';
        }
    }

    async connect() {
        if (!this.provider) {
            this.showMessage('HashPack wallet not found. Please install it first.', 'error');
            return;
        }

        this.setLoading(true, 'Connecting...');

        try {
            const accounts = await this.provider.request({
                method: 'hedera_requestAccount'
            });

            // Validate testnet connection
            if (accounts.network !== 'testnet') {
                this.showMessage(`❌ Connected to ${accounts.network}. Please switch to TESTNET in HashPack.`, 'error');
                this.setLoading(false);
                return;
            }

            this.connectedAccount = accounts;
            this.isConnected = true;
            
            this.updateUI();
            this.showMessage('✅ Successfully connected to HashPack Testnet!', 'success');
            
            // Get initial balance
            await this.getBalance();
            
        } catch (error) {
            console.error('Connection error:', error);
            if (error.code === 4001) {
                this.showMessage('Connection request was rejected.', 'error');
            } else {
                this.showMessage('Failed to connect: ' + error.message, 'error');
            }
        } finally {
            this.setLoading(false);
        }
    }

    disconnect() {
        this.connectedAccount = null;
        this.isConnected = false;
        this.updateUI();
        this.showMessage('Disconnected from HashPack.', 'info');
    }

    async getBalance() {
        if (!this.isConnected || !this.connectedAccount) {
            this.showMessage('Please connect to HashPack first.', 'error');
            return;
        }

        try {
            const balance = await this.provider.request({
                method: 'hedera_getAccountBalance',
                params: { accountId: this.connectedAccount.accountId }
            });

            this.balanceValue.textContent = `${balance} ℏ`;
            this.showMessage(`Balance updated: ${balance} HBAR`, 'success');
            
        } catch (error) {
            console.error('Balance error:', error);
            this.showMessage('Failed to get balance: ' + error.message, 'error');
        }
    }

    async sendTransaction() {
        if (!this.isConnected) {
            this.showMessage('Please connect to HashPack first.', 'error');
            return;
        }

        const recipient = this.recipientInput.value.trim();
        const amount = parseFloat(this.amountInput.value);

        if (!recipient || !amount) {
            this.showMessage('Please fill in all fields.', 'error');
            return;
        }

        // Basic account ID validation
        if (!recipient.match(/^\d+\.\d+\.\d+$/)) {
            this.showMessage('Please enter a valid account ID (format: 0.0.123456)', 'error');
            return;
        }

        if (amount <= 0) {
            this.showMessage('Please enter a valid amount greater than 0.', 'error');
            return;
        }

        this.setLoading(true, 'Sending transaction...');

        try {
            // Create a transfer transaction
            const transaction = {
                nodeId: { shard: 0, realm: 0, account: 3 }, // Testnet node
                transactionFee: 1000000, // 0.01 HBAR
                transactionValidDuration: 120, // 2 minutes
                memo: "Test transaction from Flask dApp",
                cryptoTransfer: {
                    transfers: [
                        {
                            accountId: this.connectedAccount.accountId,
                            amount: -amount * 100000000 // Convert to tinybars (negative for sender)
                        },
                        {
                            accountId: recipient,
                            amount: amount * 100000000 // Convert to tinybars (positive for receiver)
                        }
                    ]
                }
            };

            const signedTransaction = await this.provider.request({
                method: 'hedera_signAndExecuteTransaction',
                params: { transaction }
            });

            this.showMessage(`✅ Transaction sent successfully! Transaction ID: ${signedTransaction.transactionId}`, 'success');
            
            // Clear form
            this.recipientInput.value = '';
            this.amountInput.value = '';
            
            // Update balance
            setTimeout(() => this.getBalance(), 2000);
            
        } catch (error) {
            console.error('Transaction error:', error);
            this.showMessage('Transaction failed: ' + error.message, 'error');
        } finally {
            this.setLoading(false);
        }
    }

    updateUI() {
        if (this.isConnected && this.connectedAccount) {
            // Update status
            this.statusIndicator.textContent = 'Connected';
            this.statusIndicator.className = 'status-indicator connected';
            
            // Update account info
            this.networkValue.textContent = this.connectedAccount.network.toUpperCase();
            this.accountIdValue.textContent = this.connectedAccount.accountId;
            
            // Enable/disable buttons
            this.connectButton.disabled = true;
            this.disconnectButton.disabled = false;
            this.getBalanceButton.disabled = false;
            
            // Show transaction section
            this.transactionSection.style.display = 'block';
            
        } else {
            // Reset status
            this.statusIndicator.textContent = 'Disconnected';
            this.statusIndicator.className = 'status-indicator disconnected';
            
            // Reset account info
            this.networkValue.textContent = '-';
            this.accountIdValue.textContent = '-';
            this.balanceValue.textContent = '-';
            
            // Enable/disable buttons
            this.connectButton.disabled = false;
            this.disconnectButton.disabled = true;
            this.getBalanceButton.disabled = true;
            
            // Hide transaction section
            this.transactionSection.style.display = 'none';
        }
    }

    setLoading(loading, text = 'Connect to HashPack') {
        if (loading) {
            this.connectButton.disabled = true;
            this.connectButton.innerHTML = '⏳ ' + text;
        } else {
            this.connectButton.disabled = false;
            this.connectButton.innerHTML = this.isConnected ? '🔗 Connected' : '🔗 Connect to HashPack';
        }
    }

    showMessage(message, type = 'info') {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${type}`;
        messageElement.textContent = message;
        
        this.messageContainer.appendChild(messageElement);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (messageElement.parentNode) {
                messageElement.parentNode.removeChild(messageElement);
            }
        }, 5000);
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.hashPackConnector = new HashPackConnector();
    
    // Check backend status
    fetch('/api/testnet-status')
        .then(response => response.json())
        .then(data => {
            console.log('Backend status:', data);
        })
        .catch(error => {
            console.error('Backend check failed:', error);
        });
});

// Listen for account changes (if HashPack supports it)
window.addEventListener('hedera_accountChanged', (event) => {
    console.log('Account changed:', event.detail);
    if (window.hashPackConnector) {
        window.hashPackConnector.disconnect();
    }
});

// Listen for network changes (if HashPack supports it)
window.addEventListener('hedera_networkChanged', (event) => {
    console.log('Network changed:', event.detail);
    if (window.hashPackConnector && window.hashPackConnector.isConnected) {
        window.hashPackConnector.showMessage('Network changed. Please reconnect.', 'info');
        window.hashPackConnector.disconnect();
    }
});
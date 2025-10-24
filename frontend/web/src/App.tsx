// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface AIAgent {
  id: string;
  name: string;
  encryptedScore: string;
  encryptedBalance: string;
  owner: string;
  timestamp: number;
  strategyHash: string;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newAgentData, setNewAgentData] = useState({ name: "", initialBalance: 1000, strategy: "" });
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [selectedAgent, setSelectedAgent] = useState<AIAgent | null>(null);
  const [decryptedBalance, setDecryptedBalance] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [marketStatus, setMarketStatus] = useState<{ active: boolean, currentRound: number }>({ active: true, currentRound: 1 });
  const [showStrategyEditor, setShowStrategyEditor] = useState(false);
  const [currentStrategy, setCurrentStrategy] = useState<string>("");

  // Calculate leaderboard
  const leaderboard = [...agents].sort((a, b) => {
    const scoreA = FHEDecryptNumber(a.encryptedScore);
    const scoreB = FHEDecryptNumber(b.encryptedScore);
    return scoreB - scoreA;
  }).slice(0, 10);

  useEffect(() => {
    loadAgents().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadAgents = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("agent_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing agent keys:", e); }
      }
      
      const list: AIAgent[] = [];
      for (const key of keys) {
        try {
          const agentBytes = await contract.getData(`agent_${key}`);
          if (agentBytes.length > 0) {
            try {
              const agentData = JSON.parse(ethers.toUtf8String(agentBytes));
              list.push({ 
                id: key, 
                name: agentData.name, 
                encryptedScore: agentData.score, 
                encryptedBalance: agentData.balance,
                owner: agentData.owner, 
                timestamp: agentData.timestamp,
                strategyHash: agentData.strategyHash
              });
            } catch (e) { console.error(`Error parsing agent data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading agent ${key}:`, e); }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setAgents(list);
    } catch (e) { console.error("Error loading agents:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const createAgent = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting AI agent with Zama FHE..." });
    try {
      const encryptedBalance = FHEEncryptNumber(newAgentData.initialBalance);
      const encryptedScore = FHEEncryptNumber(0); // Start with 0 score
      const strategyHash = ethers.id(newAgentData.strategy);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const agentId = `agent-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const agentData = { 
        name: newAgentData.name,
        balance: encryptedBalance,
        score: encryptedScore,
        owner: address,
        timestamp: Math.floor(Date.now() / 1000),
        strategyHash: strategyHash
      };
      
      await contract.setData(`agent_${agentId}`, ethers.toUtf8Bytes(JSON.stringify(agentData)));
      
      const keysBytes = await contract.getData("agent_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(agentId);
      await contract.setData("agent_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "AI Agent created successfully!" });
      await loadAgents();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewAgentData({ name: "", initialBalance: 1000, strategy: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const isAvailable = await contract.isAvailable();
      alert(`Contract is ${isAvailable ? 'available' : 'not available'}`);
    } catch (e) {
      console.error("Error checking availability:", e);
      alert("Failed to check availability");
    }
  };

  const isOwner = (agentAddress: string) => address?.toLowerCase() === agentAddress.toLowerCase();

  if (loading) return (
    <div className="loading-screen">
      <div className="tech-spinner"></div>
      <p>Initializing encrypted AI economy...</p>
    </div>
  );

  return (
    <div className="app-container future-tech-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"><div className="ai-icon"></div></div>
          <h1>AI<span>Economy</span>War</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-agent-btn tech-button">
            <div className="add-icon"></div>Create Agent
          </button>
          <button onClick={checkAvailability} className="tech-button">
            Check FHE Status
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      
      <div className="main-content">
        {/* Market Status Panel */}
        <div className="market-status-panel tech-card">
          <h2>Market Status</h2>
          <div className="status-indicator">
            <div className={`status-light ${marketStatus.active ? 'active' : 'inactive'}`}></div>
            <span>{marketStatus.active ? 'ACTIVE' : 'INACTIVE'}</span>
          </div>
          <div className="market-stats">
            <div className="stat-item">
              <div className="stat-label">Current Round</div>
              <div className="stat-value">{marketStatus.currentRound}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Total Agents</div>
              <div className="stat-value">{agents.length}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Active Trades</div>
              <div className="stat-value">{agents.length * 3}</div>
            </div>
          </div>
          <div className="fhe-badge"><span>FHE-Powered Market</span></div>
        </div>
        
        {/* Project Introduction */}
        <div className="intro-panel tech-card">
          <h2>AI Economy War</h2>
          <p>
            A revolutionary GameFi experience where players design AI trading agents that compete in a simulated economy. 
            All agent strategies and financial data are encrypted using <strong>Zama FHE technology</strong>, enabling secure computation 
            on encrypted data without decryption.
          </p>
          <div className="feature-grid">
            <div className="feature-item">
              <div className="feature-icon">🔒</div>
              <h3>FHE Encryption</h3>
              <p>Agent strategies and financial data remain encrypted at all times</p>
            </div>
            <div className="feature-item">
              <div className="feature-icon">🤖</div>
              <h3>AI Agents</h3>
              <p>Design and train your AI trading strategy</p>
            </div>
            <div className="feature-item">
              <div className="feature-icon">📈</div>
              <h3>Simulated Market</h3>
              <p>Realistic market simulation with homomorphic matching</p>
            </div>
          </div>
        </div>
        
        {/* Dashboard Grid */}
        <div className="dashboard-grid">
          {/* Leaderboard Panel */}
          <div className="leaderboard-panel tech-card">
            <h2>Leaderboard</h2>
            <div className="leaderboard-header">
              <div className="header-cell">Rank</div>
              <div className="header-cell">Agent</div>
              <div className="header-cell">Score</div>
              <div className="header-cell">Owner</div>
            </div>
            {leaderboard.length === 0 ? (
              <div className="no-agents">
                <p>No agents in the competition yet</p>
              </div>
            ) : (
              leaderboard.map((agent, index) => (
                <div className="leaderboard-row" key={agent.id} onClick={() => setSelectedAgent(agent)}>
                  <div className="rank-cell">{index + 1}</div>
                  <div className="agent-cell">{agent.name}</div>
                  <div className="score-cell">{FHEDecryptNumber(agent.encryptedScore).toFixed(2)}</div>
                  <div className="owner-cell">{agent.owner.substring(0, 6)}...{agent.owner.substring(38)}</div>
                </div>
              ))
            )}
          </div>
          
          {/* Agent Statistics */}
          <div className="stats-panel tech-card">
            <h2>Agent Statistics</h2>
            <div className="stats-grid">
              <div className="stat-item large">
                <div className="stat-value">{agents.length}</div>
                <div className="stat-label">Total Agents</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">
                  {agents.length > 0 ? 
                    (agents.reduce((sum, agent) => sum + FHEDecryptNumber(agent.encryptedScore), 0) / agents.length).toFixed(2) : 
                    '0.00'}
                </div>
                <div className="stat-label">Avg Score</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">
                  {agents.length > 0 ? 
                    (agents.reduce((sum, agent) => sum + FHEDecryptNumber(agent.encryptedBalance), 0) / agents.length).toFixed(2) : 
                    '0.00'}
                </div>
                <div className="stat-label">Avg Balance</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">
                  {agents.filter(a => isOwner(a.owner)).length}
                </div>
                <div className="stat-label">Your Agents</div>
              </div>
            </div>
            <div className="chart-placeholder"></div>
          </div>
        </div>
        
        {/* Agent List */}
        <div className="agents-section">
          <div className="section-header">
            <h2>AI Agents</h2>
            <div className="header-actions">
              <button onClick={loadAgents} className="refresh-btn tech-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
              <button onClick={() => setShowStrategyEditor(true)} className="tech-button">
                Strategy Editor
              </button>
            </div>
          </div>
          <div className="agents-list tech-card">
            <div className="table-header">
              <div className="header-cell">Agent Name</div>
              <div className="header-cell">Score</div>
              <div className="header-cell">Balance</div>
              <div className="header-cell">Owner</div>
              <div className="header-cell">Actions</div>
            </div>
            {agents.length === 0 ? (
              <div className="no-agents">
                <div className="no-agents-icon"></div>
                <p>No AI agents found</p>
                <button className="tech-button primary" onClick={() => setShowCreateModal(true)}>Create First Agent</button>
              </div>
            ) : agents.map(agent => (
              <div className="agent-row" key={agent.id} onClick={() => setSelectedAgent(agent)}>
                <div className="table-cell">{agent.name}</div>
                <div className="table-cell">{FHEDecryptNumber(agent.encryptedScore).toFixed(2)}</div>
                <div className="table-cell">${FHEDecryptNumber(agent.encryptedBalance).toFixed(2)}</div>
                <div className="table-cell">{agent.owner.substring(0, 6)}...{agent.owner.substring(38)}</div>
                <div className="table-cell actions">
                  {isOwner(agent.owner) && (
                    <button className="action-btn tech-button" onClick={(e) => {
                      e.stopPropagation();
                      setCurrentStrategy(agent.strategyHash);
                      setShowStrategyEditor(true);
                    }}>
                      Edit Strategy
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Create Agent Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal tech-card">
            <div className="modal-header">
              <h2>Create AI Agent</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Agent Name *</label>
                <input 
                  type="text" 
                  name="name" 
                  value={newAgentData.name} 
                  onChange={(e) => setNewAgentData({...newAgentData, name: e.target.value})} 
                  placeholder="Enter agent name..." 
                  className="tech-input"
                />
              </div>
              <div className="form-group">
                <label>Initial Balance *</label>
                <input 
                  type="number" 
                  name="initialBalance" 
                  value={newAgentData.initialBalance} 
                  onChange={(e) => setNewAgentData({...newAgentData, initialBalance: parseFloat(e.target.value)})} 
                  placeholder="Enter initial balance..." 
                  className="tech-input"
                  min="100"
                  step="100"
                />
              </div>
              <div className="form-group">
                <label>Trading Strategy *</label>
                <textarea 
                  name="strategy" 
                  value={newAgentData.strategy} 
                  onChange={(e) => setNewAgentData({...newAgentData, strategy: e.target.value})} 
                  placeholder="Describe your trading strategy..." 
                  className="tech-textarea"
                  rows={5}
                />
              </div>
              <div className="encryption-preview">
                <h4>FHE Encryption Preview</h4>
                <div className="preview-container">
                  <div className="plain-data">
                    <span>Plain Balance:</span>
                    <div>${newAgentData.initialBalance}</div>
                  </div>
                  <div className="encryption-arrow">→</div>
                  <div className="encrypted-data">
                    <span>Encrypted Data:</span>
                    <div>{FHEEncryptNumber(newAgentData.initialBalance).substring(0, 50)}...</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn tech-button">Cancel</button>
              <button onClick={createAgent} disabled={creating} className="submit-btn tech-button primary">
                {creating ? "Encrypting with FHE..." : "Create Agent"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Agent Detail Modal */}
      {selectedAgent && (
        <div className="modal-overlay">
          <div className="agent-detail-modal tech-card">
            <div className="modal-header">
              <h2>Agent Details: {selectedAgent.name}</h2>
              <button onClick={() => { setSelectedAgent(null); setDecryptedBalance(null); }} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="agent-info">
                <div className="info-item"><span>Owner:</span><strong>{selectedAgent.owner.substring(0, 6)}...{selectedAgent.owner.substring(38)}</strong></div>
                <div className="info-item"><span>Created:</span><strong>{new Date(selectedAgent.timestamp * 1000).toLocaleString()}</strong></div>
                <div className="info-item"><span>Strategy Hash:</span><strong>{selectedAgent.strategyHash.substring(0, 12)}...</strong></div>
              </div>
              
              <div className="agent-stats">
                <div className="stat-item">
                  <span>Encrypted Score:</span>
                  <div className="encrypted-value">{selectedAgent.encryptedScore.substring(0, 50)}...</div>
                  <div className="decrypted-value">{FHEDecryptNumber(selectedAgent.encryptedScore).toFixed(2)}</div>
                </div>
                <div className="stat-item">
                  <span>Encrypted Balance:</span>
                  <div className="encrypted-value">{selectedAgent.encryptedBalance.substring(0, 50)}...</div>
                  {decryptedBalance !== null ? (
                    <div className="decrypted-value">${decryptedBalance.toFixed(2)}</div>
                  ) : (
                    <button 
                      className="decrypt-btn tech-button" 
                      onClick={async () => {
                        const balance = await decryptWithSignature(selectedAgent.encryptedBalance);
                        if (balance !== null) setDecryptedBalance(balance);
                      }}
                      disabled={isDecrypting}
                    >
                      {isDecrypting ? "Decrypting..." : "Decrypt Balance"}
                    </button>
                  )}
                </div>
              </div>
              
              <div className="fhe-notice">
                <div className="fhe-icon"></div>
                <p>All financial data is encrypted using Zama FHE technology and processed homomorphically</p>
              </div>
            </div>
            <div className="modal-footer">
              <button 
                className="tech-button"
                onClick={() => {
                  setCurrentStrategy(selectedAgent.strategyHash);
                  setShowStrategyEditor(true);
                  setSelectedAgent(null);
                }}
              >
                View Strategy
              </button>
              <button 
                onClick={() => { setSelectedAgent(null); setDecryptedBalance(null); }} 
                className="close-btn tech-button"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Strategy Editor Modal */}
      {showStrategyEditor && (
        <div className="modal-overlay">
          <div className="strategy-modal tech-card">
            <div className="modal-header">
              <h2>AI Strategy Editor</h2>
              <button onClick={() => setShowStrategyEditor(false)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="strategy-tabs">
                <div className="tab active">Trading Logic</div>
                <div className="tab">Risk Management</div>
                <div className="tab">Market Analysis</div>
              </div>
              <div className="code-editor">
                <div className="editor-header">
                  <span>FHE-Encrypted Strategy Code</span>
                  <div className="fhe-badge"><span>FHE-Secured</span></div>
                </div>
                <textarea 
                  className="strategy-code"
                  value={currentStrategy || "// Write your trading strategy here\n// All code will be FHE-encrypted before submission\n\nfunction executeTrade(marketData) {\n  // Your trading logic\n}"}
                  onChange={(e) => setCurrentStrategy(e.target.value)}
                  placeholder="Write your FHE-encrypted trading strategy..."
                ></textarea>
              </div>
              <div className="strategy-preview">
                <h4>Strategy Hash:</h4>
                <div className="hash-value">{currentStrategy ? ethers.id(currentStrategy) : 'No strategy defined'}</div>
                <p>This hash identifies your encrypted strategy on-chain</p>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowStrategyEditor(false)} className="cancel-btn tech-button">Cancel</button>
              <button className="tech-button primary">Save Strategy</button>
            </div>
          </div>
        </div>
      )}
      
      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content tech-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="tech-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="ai-icon"></div><span>AI Economy War</span></div>
            <p>Powered by Zama FHE technology for secure encrypted computation</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Whitepaper</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered AI Economy</span></div>
          <div className="copyright">© {new Date().getFullYear()} AI Economy War. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

export default App;

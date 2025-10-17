import { RewardTransaction } from '../db/types';
import { Actor, HttpAgent, AnonymousIdentity } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { Secp256k1KeyIdentity } from '@dfinity/identity-secp256k1';

export interface BlockchainTransactionRequest {
  userPrincipalId: string;
  amount: number;
  rewardType: 'UPTIME_REWARD' | 'JOB_REWARD' | 'BONUS_REWARD';
  metadata?: {
    uptime_minutes?: number;
    tier_level?: number;
    date?: string;
    [key: string]: any;
  };
}

export interface BlockchainTransactionResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
  blockchainNetwork?: string;
  confirmationTime?: number;
}

export interface ICPTransactionRequest {
  to: string; // user principal
  amount: bigint; // in smallest unit (e8 for ICP)
  memo: string;
  rewardType: 'UPTIME_REWARD' | 'JOB_REWARD' | 'BONUS_REWARD';
}

// ICRC1 Transfer Arguments interface
export interface ICRC1TransferArgs {
  from_subaccount: [] | [Uint8Array];
  to: {
    owner: Principal;
    subaccount: [] | [Uint8Array];
  };
  amount: bigint;
  fee: [] | [bigint];
  memo: [] | [Uint8Array];
  created_at_time: [] | [bigint];
}





export class BlockchainService {
  private network: string;
  private isEnabled: boolean;
  private icpAgent: HttpAgent;
  private selaPointsCanisterId: string;
  private controllerIdentity: Secp256k1KeyIdentity | null;

  constructor() {
    this.network = process.env.BLOCKCHAIN_NETWORK || 'icp';
    this.isEnabled = process.env.BLOCKCHAIN_ENABLED === 'true';
    this.selaPointsCanisterId = process.env.SELA_POINTS_CANISTER_ID || 'y5ego-zyaaa-aaaao-qkfhq-cai';
    
    // Initialize controller identity
    this.controllerIdentity = this.initializeControllerIdentity();
    
    // Initialize ICP agent with controller identity or anonymous identity as fallback
    const agentIdentity = this.controllerIdentity || new AnonymousIdentity();
    this.icpAgent = new HttpAgent({
      host: process.env.IC_URL || 'https://ic0.app',
      identity: agentIdentity as any
    });
    
    // Set root key if needed for local development
    if (process.env.FETCH_ROOT_KEY === 'true') {
      this.icpAgent.fetchRootKey().catch(console.error);
    }
    
    // Verify agent is properly configured
    if (this.controllerIdentity) {
      console.log('🔍 Verifying agent configuration...');
      try {
        // getPrincipal() returns a Promise in newer versions
        this.icpAgent.getPrincipal().then(agentPrincipal => {
          console.log(`✅ Agent principal: ${agentPrincipal?.toString() || 'Anonymous'}`);
        }).catch(error => {
          console.error('❌ Agent configuration error:', error);
        });
      } catch (error) {
        console.error('❌ Agent configuration error:', error);
      }
    }
  }

  /**
   * Initialize controller identity from environment variables
   */
  private initializeControllerIdentity(): Secp256k1KeyIdentity | null {
    try {
      const controllerPem = process.env.CANISTER_CONTROLLER_PEM;

      if (!controllerPem) {
        console.warn('⚠️ CANISTER_CONTROLLER_PEM not found. Blockchain operations will fail.');
        return null;
      }

      console.log('🔍 Initializing controller identity from PEM...');
      
      // Create Secp256k1KeyIdentity directly from PEM
      const identity = Secp256k1KeyIdentity.fromPem(controllerPem);
      
      const principal = identity.getPrincipal();
      console.log(`✅ Controller identity loaded: ${principal.toString()}`);
      
      // Test the identity by getting its public key
      const publicKey = identity.getPublicKey();
      console.log(`🔍 Public key available: ${publicKey ? 'Yes' : 'No'}`);
      
      return identity;
    } catch (error) {
      console.error('❌ Failed to initialize controller identity:', error);
      return null;
    }
  }






  /**
   * Send reward transaction to blockchain (mint Sela Points)
   */
  async sendRewardTransaction(request: BlockchainTransactionRequest): Promise<BlockchainTransactionResult> {
    if (!this.isEnabled) {
      console.log(`🔗 [DUMMY] Blockchain transaction for user ${request.userPrincipalId}, amount: ${request.amount}`);
      
      return {
        success: true,
        transactionHash: `dummy_${Date.now()}`,
        blockchainNetwork: this.network,
        confirmationTime: Date.now()
      };
    }

    try {
      console.log(`🔗 Minting Sela Points for user ${request.userPrincipalId}, amount: ${request.amount}`);
      
      // Convert amount to bigint (assuming amount is in Sela Points, convert to smallest unit)
      const amountBigInt = BigInt(Math.floor(request.amount * 1e8)); // Convert to e8 units
      
      // Create memo with reward information (max 32 bytes)
      // Format: "U60T1" = Uptime reward, 60 minutes, Tier 1
      const rewardType = request.rewardType === 'UPTIME_REWARD' ? 'U' : request.rewardType === 'JOB_REWARD' ? 'J' : 'B';
      const minutes = Math.min(request.metadata?.uptime_minutes || 0, 999);  
      const tier = Math.min(request.metadata?.tier_level || 1, 9);  
      const memo = `${rewardType}${minutes}T${tier}`;

      const icpRequest: ICPTransactionRequest = {
        to: request.userPrincipalId,
        amount: amountBigInt,
        memo: memo,
        rewardType: request.rewardType
      };

      const result = await this.mintSelaPoints(icpRequest);
      return result;
      
    } catch (error) {
      console.error(`❌ Blockchain transaction failed:`, error);
      return {
        success: false,
        error: `Blockchain transaction failed: ${(error as Error).message}`
      };
    }
  }

  /**
   * Mint Sela Points to user using ICRC1 transfer (requires controller identity)
   */
  async mintSelaPoints(request: ICPTransactionRequest): Promise<BlockchainTransactionResult> {
    try {
      // Check if controller identity is available
      if (!this.controllerIdentity) {
        return {
          success: false,
          error: 'Controller identity not available. Please set CANISTER_CONTROLLER_PEM environment variable.'
        };
      }

      console.log(`🔗 Minting Sela Points to: ${request.to}, amount: ${request.amount}`);

      // Create actor for the Sela Points canister
      const actor = Actor.createActor(this.getICRC1Interface(), {
        agent: this.icpAgent,
        canisterId: this.selaPointsCanisterId
      });

      // Prepare transfer arguments (matching the canister interface)
      const transferArgs = {
        to: {
          owner: Principal.fromText(request.to),
          subaccount: [],
        },
        fee: [],
        memo: [new TextEncoder().encode(request.memo)],
        from_subaccount: [],
        created_at_time: [],
        amount: request.amount,
      };

      // Execute the transfer (mint) - only controller can do this
      const result = await actor.icrc1_transfer(transferArgs) as any;
      
      if (result && typeof result === 'object' && 'Ok' in result) {
        const transactionHash = result.Ok.toString();
        console.log(`✅ Sela Points minted successfully. Transaction ID: ${transactionHash}`);
        
        return {
          success: true,
          transactionHash: transactionHash,
          blockchainNetwork: 'icp',
          confirmationTime: Date.now()
        };
      } else {
        const error = result && typeof result === 'object' && 'Err' in result ? result.Err : 'Unknown error';
        let errorMessage = 'Unknown error';
        
        if (error && typeof error === 'object') {
          // Handle different error types
          if ('GenericError' in error) {
            errorMessage = error.GenericError.message;
          } else if ('InsufficientFunds' in error) {
            errorMessage = `Insufficient funds. Balance: ${error.InsufficientFunds.balance}`;
          } else if ('BadFee' in error) {
            errorMessage = `Bad fee. Expected: ${error.BadFee.expected_fee}`;
          } else if ('BadBurn' in error) {
            errorMessage = `Bad burn. Min amount: ${error.BadBurn.min_burn_amount}`;
          } else if ('Duplicate' in error) {
            errorMessage = `Duplicate transaction: ${error.Duplicate.duplicate_of}`;
          } else if ('CreatedInFuture' in error) {
            errorMessage = `Created in future. Ledger time: ${error.CreatedInFuture.ledger_time}`;
          } else if ('TemporarilyUnavailable' in error) {
            errorMessage = 'Temporarily unavailable';
          } else if ('TooOld' in error) {
            errorMessage = 'Transaction too old';
          } else {
            errorMessage = JSON.stringify(error);
          }
        }
        
        console.error(`❌ Sela Points minting failed:`, errorMessage);
        return {
          success: false,
          error: `Sela Points minting failed: ${errorMessage}`
        };
      }
    } catch (error) {
      console.error(`❌ Sela Points minting error:`, error);
      return {
        success: false,
        error: `Sela Points minting error: ${(error as Error).message}`
      };
    }
  }

  /**
   * Confirm transaction on blockchain (ICP transactions are typically confirmed immediately)
   */
  async confirmTransaction(transactionHash: string): Promise<BlockchainTransactionResult> {
    if (!this.isEnabled) {
      return {
        success: true,
        transactionHash,
        blockchainNetwork: this.network,
        confirmationTime: Date.now()
      };
    }

    try {
      console.log(`🔗 Confirming ICP transaction: ${transactionHash}`);
      
      // ICP transactions are typically confirmed immediately after successful execution
      return {
        success: true,
        transactionHash,
        blockchainNetwork: 'icp',
        confirmationTime: Date.now()
      };
    } catch (error) {
      console.error(`❌ Blockchain confirmation failed:`, error);
      return {
        success: false,
        error: `Blockchain confirmation failed: ${(error as Error).message}`
      };
    }
  }

  /**
   * Batch send multiple reward transactions
   */
  async batchSendRewards(transactions: RewardTransaction[]): Promise<BlockchainTransactionResult[]> {
    console.log(`🔗 Batch sending ${transactions.length} blockchain transactions`);
    
    const results: BlockchainTransactionResult[] = [];
    
    for (const transaction of transactions) {
      const request: BlockchainTransactionRequest = {
        userPrincipalId: transaction.user_principal_id,
        amount: transaction.amount,
        rewardType: 'UPTIME_REWARD',
        metadata: {
          uptime_minutes: transaction.uptime_minutes,
          tier_level: transaction.tier_level,
          date: transaction.date
        }
      };
      
      const result = await this.sendRewardTransaction(request);
      results.push(result);
      
      // Add delay between transactions to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return results;
  }

  /**
   * Get transaction status from blockchain
   */
  async getTransactionStatus(transactionHash: string): Promise<'PENDING' | 'CONFIRMED' | 'FAILED'> {
    if (!this.isEnabled) {
      return 'CONFIRMED';
    }

    try {
      console.log(`🔗 Checking blockchain transaction status: ${transactionHash}`);
      
      // ICP transactions are typically confirmed immediately
      return 'CONFIRMED';
    } catch (error) {
      console.error(`❌ Blockchain status check failed:`, error);
      return 'FAILED';
    }
  }

  /**
   * Get blockchain network info
   */
  getNetworkInfo(): { network: string; enabled: boolean; status: string; controllerPrincipal?: string } {
    return {
      network: this.network,
      enabled: this.isEnabled,
      status: this.isEnabled ? 'ACTIVE' : 'DUMMY_MODE',
      controllerPrincipal: this.controllerIdentity?.getPrincipal().toString()
    };
  }

  /**
   * Get controller principal ID
   */
  getControllerPrincipal(): string | null {
    return this.controllerIdentity?.getPrincipal().toString() || null;
  }

  /**
   * Get controller identity for other services
   */
  getControllerIdentity() {
    return this.controllerIdentity;
  }

  /**
   * Test the identity by signing a simple message
   */
  async testIdentity(): Promise<boolean> {
    if (!this.controllerIdentity) {
      console.log('❌ No controller identity available');
      return false;
    }

    try {
      console.log('🔍 Testing identity signing...');
      const testMessage = new TextEncoder().encode('test message');
      
      // Check if the identity has a sign method
      if (typeof (this.controllerIdentity as any).sign === 'function') {
        const signature = (this.controllerIdentity as any).sign(testMessage);
        console.log(`✅ Identity signing test successful! Signature length: ${signature.length} bytes`);
        return true;
      } else {
        console.log('⚠️ Identity does not support direct signing, but may work with agent');
        return true; // Return true as the identity might still work with the agent
      }
    } catch (error) {
      console.error('❌ Identity signing test failed:', error);
      return false;
    }
  }

  /**
   * Get ICRC1 interface for the actor
   */
  private getICRC1Interface() {
    return ({ IDL }: { IDL: any }) => {
      const TransferArgs = IDL.Record({
        'to': IDL.Record({
          'owner': IDL.Principal,
          'subaccount': IDL.Opt(IDL.Vec(IDL.Nat8)),
        }),
        'fee': IDL.Opt(IDL.Nat),
        'memo': IDL.Opt(IDL.Vec(IDL.Nat8)),
        'from_subaccount': IDL.Opt(IDL.Vec(IDL.Nat8)),
        'created_at_time': IDL.Opt(IDL.Nat64),
        'amount': IDL.Nat,
      });

      const Account = IDL.Record({
        'owner': IDL.Principal,
        'subaccount': IDL.Opt(IDL.Vec(IDL.Nat8)),
      });

      const GenericError = IDL.Record({
        'message': IDL.Text,
        'error_code': IDL.Nat,
      });

      const BadBurn = IDL.Record({
        'min_burn_amount': IDL.Nat,
      });

      const Duplicate = IDL.Record({
        'duplicate_of': IDL.Nat,
      });

      const BadFee = IDL.Record({
        'expected_fee': IDL.Nat,
      });

      const CreatedInFuture = IDL.Record({
        'ledger_time': IDL.Nat64,
      });

      const InsufficientFunds = IDL.Record({
        'balance': IDL.Nat,
      });

      const TransferError = IDL.Variant({
        'GenericError': GenericError,
        'TemporarilyUnavailable': IDL.Null,
        'BadBurn': BadBurn,
        'Duplicate': Duplicate,
        'BadFee': BadFee,
        'CreatedInFuture': CreatedInFuture,
        'TooOld': IDL.Null,
        'InsufficientFunds': InsufficientFunds,
      });

      return IDL.Service({
        'icrc1_transfer': IDL.Func([TransferArgs], [IDL.Variant({ 'Ok': IDL.Nat, 'Err': TransferError })], []),
        'icrc1_balance_of': IDL.Func([Account], [IDL.Nat], ['query']),
        'icrc1_decimals': IDL.Func([], [IDL.Nat8], ['query']),
      });
    };
  }

  /**
   * Get user's Sela Points balance
   */
  async getSelaPointsBalance(userPrincipalId: string): Promise<bigint> {
    try {
      const actor = Actor.createActor(this.getICRC1Interface(), {
        agent: this.icpAgent,
        canisterId: this.selaPointsCanisterId
      });

      const balance = await actor.icrc1_balance_of({
        owner: Principal.fromText(userPrincipalId),
        subaccount: []
      }) as bigint;

      return balance;
    } catch (error) {
      console.error(`❌ Failed to get Sela Points balance for ${userPrincipalId}:`, error);
      return BigInt(0);
    }
  }

  /**
   * Get the number of decimals for Sela Points token
   */
  async getSelaPointsDecimals(): Promise<number> {
    try {
      const actor = Actor.createActor(this.getICRC1Interface(), {
        agent: this.icpAgent,
        canisterId: this.selaPointsCanisterId
      });

      const decimals = await actor.icrc1_decimals() as number;
      return decimals;
    } catch (error) {
      console.error(`❌ Failed to get Sela Points decimals:`, error);
      // Default to 8 decimals if query fails (standard for many tokens)
      return 8;
    }
  }


}


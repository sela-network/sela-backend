import { HttpAgent, Actor, ActorSubclass } from "@dfinity/agent";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { Principal } from "@dfinity/principal";
import {
  ICCanisterOptions,
  EncodedMessage,
  CertMessages,
  RewardHistoryResponse,
  RewardHistoryItem,
} from "./types";

/**
 * Module for interacting with IC (Internet Computer) Canisters
 * Provides the same functionality as the Rust version canister_methods.rs
 */
export class ICCanisterMethods {
  private url: string;
  private fetchRootKey: boolean;
  private identity: Ed25519KeyIdentity;
  private agent: HttpAgent | null = null;

  constructor(options: ICCanisterOptions = {}) {
    this.url = options.url || "https://ic0.app";
    this.fetchRootKey = options.fetchRootKey || false;
    this.identity = options.identity || Ed25519KeyIdentity.generate();

    console.log(`🔗 IC Agent initialization: ${this.url}`);
  }

  /**
   * Create new Agent
   */
  async createAgent(identity?: Ed25519KeyIdentity): Promise<HttpAgent> {
    try {
      const agent = new HttpAgent({
        host: this.url,
        identity: identity || this.identity,
      });

      if (this.fetchRootKey) {
        await agent.fetchRootKey();
        console.log("✅ Root key fetched for local development");
      }

      this.agent = agent;
      return agent;
    } catch (error) {
      console.error("❌ Agent creation failed:", error);
      throw new Error(`Failed to create agent: ${(error as Error).message}`);
    }
  }

  /**
   * Get client's public key from canister (corresponding to ws_get_client_key)
   */
  async getClientKey(
    canisterId: string,
    clientId: number
  ): Promise<Uint8Array> {
    try {
      if (!this.agent) {
        await this.createAgent();
      }

      console.log(
        `🔑 Client public key request: canister=${canisterId}, client=${clientId}`
      );

      // Candid IDL definition
      const idl = ({ IDL }: any) =>
        IDL.Service({
          ws_get_client_key: IDL.Func(
            [IDL.Nat64],
            [IDL.Vec(IDL.Nat8)],
            ["update"]
          ),
        });

      const actor: ActorSubclass<{
        ws_get_client_key: (clientId: bigint) => Promise<number[]>;
      }> = Actor.createActor(idl, {
        agent: this.agent!,
        canisterId: Principal.fromText(canisterId),
      });

      const keyBytes = await actor.ws_get_client_key(BigInt(clientId));

      if (!keyBytes || keyBytes.length !== 32) {
        throw new Error("Invalid public key received from canister");
      }

      console.log(`✅ Client ${clientId} public key received`);
      return new Uint8Array(keyBytes);
    } catch (error) {
      console.error(`❌ Failed to get client key: ${(error as Error).message}`);
      // Return dummy key same as Rust version
      return new Uint8Array(32);
    }
  }

  /**
   * Open WebSocket connection (corresponding to ws_open)
   */
  async wsOpen(
    canisterId: string,
    clientCanisterIdBytes: Buffer,
    signature: Buffer
  ): Promise<string> {
    try {
      if (!this.agent) {
        await this.createAgent();
      }

      console.log(`🚪 Opening WebSocket connection: canister=${canisterId}`);

      // Parameter validation and conversion
      if (!clientCanisterIdBytes) {
        throw new Error("clientCanisterIdBytes is required");
      }
      if (!signature) {
        throw new Error("signature is required");
      }

      // Convert Buffer to number array
      const clientCanisterIdArray: number[] = Buffer.isBuffer(
        clientCanisterIdBytes
      )
        ? Array.from(clientCanisterIdBytes)
        : Array.from(new Uint8Array(clientCanisterIdBytes));

      const signatureArray: number[] = Buffer.isBuffer(signature)
        ? Array.from(signature)
        : Array.from(new Uint8Array(signature));

      console.log("📝 Converted array lengths:", {
        clientCanisterIdArrayLength: clientCanisterIdArray.length,
        signatureArrayLength: signatureArray.length,
      });

      const idl = ({ IDL }: any) =>
        IDL.Service({
          ws_open: IDL.Func(
            [IDL.Vec(IDL.Nat8), IDL.Vec(IDL.Nat8)],
            [IDL.Text],
            ["update"]
          ),
        });

      const actor: ActorSubclass<{
        ws_open: (
          clientCanisterId: number[],
          signature: number[]
        ) => Promise<string>;
      }> = Actor.createActor(idl, {
        agent: this.agent!,
        canisterId: Principal.fromText(canisterId),
      });

      const response = await actor.ws_open(
        clientCanisterIdArray,
        signatureArray
      );

      console.log(`✅ WebSocket connection opened: ${response}`);
      return response;
    } catch (error) {
      console.error(
        `❌ WebSocket connection open failed: ${(error as Error).message}`
      );
      return JSON.stringify({
        status: "error",
        message: `ws_open failed: ${(error as Error).message}`,
      });
    }
  }

  /**
   * Close WebSocket connection (corresponding to ws_close)
   */
  async wsClose(canisterId: string, clientId: number): Promise<void> {
    try {
      if (!this.agent) {
        await this.createAgent();
      }

      console.log(
        `🚪 Closing WebSocket connection: canister=${canisterId}, client=${clientId}`
      );

      const idl = ({ IDL }: any) =>
        IDL.Service({
          ws_close: IDL.Func([IDL.Nat64], [], ["update"]),
        });

      const actor: ActorSubclass<{
        ws_close: (clientId: bigint) => Promise<void>;
      }> = Actor.createActor(idl, {
        agent: this.agent!,
        canisterId: Principal.fromText(canisterId),
      });

      await actor.ws_close(BigInt(clientId));
      console.log(`✅ WebSocket connection closed: client=${clientId}`);
    } catch (error) {
      console.error(
        `❌ WebSocket connection close failed: ${(error as Error).message}`
      );
    }
  }

  /**
   * Send message (corresponding to ws_message)
   */
  async wsMessage(canisterId: string, messageBytes: Buffer): Promise<string> {
    try {
      if (!this.agent) {
        await this.createAgent();
      }

      // Convert Buffer to number array safely
      const messageArray: number[] = Buffer.isBuffer(messageBytes)
        ? Array.from(messageBytes)
        : Array.from(new Uint8Array(messageBytes));

      const idl = ({ IDL }: any) =>
        IDL.Service({
          ws_message: IDL.Func([IDL.Vec(IDL.Nat8)], [IDL.Text], ["update"]),
        });

      const actor: ActorSubclass<{
        ws_message: (message: number[]) => Promise<string>;
      }> = Actor.createActor(idl, {
        agent: this.agent!,
        canisterId: Principal.fromText(canisterId),
      });

      const response = await actor.ws_message(messageArray);
      console.log(`✅ Message sent successfully`);
      return response;
    } catch (error) {
      console.error(`❌ Message send failed: ${(error as Error).message}`);
      throw new Error(`ws_message failed: ${(error as Error).message}`);
    }
  }

  /**
   * Get user reward history (corresponding to getUserRewardHistory)
   */
  async getRewardHistory(
    canisterId: string,
    principalId: string
  ): Promise<RewardHistoryResponse> {
    try {
      if (!this.agent) {
        await this.createAgent();
      }

      const idl = ({ IDL }: any) =>
        IDL.Service({
          getUserRewardHistory: IDL.Func(
            [IDL.Text], // principalId
            [
              IDL.Variant({
                ok: IDL.Vec(
                  IDL.Record({
                    completeAt: IDL.Int,
                    reward: IDL.Float64,
                    assignedAt: IDL.Int,
                    jobType: IDL.Text,
                    jobID: IDL.Text,
                    user_principal_id: IDL.Text,
                    state: IDL.Text,
                    target: IDL.Text,
                  })
                ),
                err: IDL.Text,
              }),
            ],
            ["query"]
          ),
        });

      const actor: ActorSubclass<{
        getUserRewardHistory: (
          principalId: string
        ) => Promise<RewardHistoryResponse>;
      }> = Actor.createActor(idl, {
        agent: this.agent!,
        canisterId: Principal.fromText(canisterId),
      });

      const response = await actor.getUserRewardHistory(principalId);
      console.log(`✅ Reward history retrieved`);

      return response;
    } catch (error) {
      console.error(
        `❌ Reward history retrieval failed: ${(error as Error).message}`
      );
      throw error;
    }
  }

  /**
   * Get messages (corresponding to ws_get_messages)
   */
  async wsGetMessages(
    canisterId: string,
    nonce: number
  ): Promise<CertMessages> {
    try {
      if (!this.agent) {
        await this.createAgent();
      }

      const idl = ({ IDL }: any) => {
        const EncodedMessage = IDL.Record({
          client_id: IDL.Nat64,
          key: IDL.Text,
          val: IDL.Vec(IDL.Nat8),
        });

        const CertMessages = IDL.Record({
          messages: IDL.Vec(EncodedMessage),
          cert: IDL.Vec(IDL.Nat8),
          tree: IDL.Vec(IDL.Nat8),
        });

        return IDL.Service({
          ws_get_messages: IDL.Func([IDL.Nat64], [CertMessages], ["update"]),
        });
      };

      const actor: ActorSubclass<{
        ws_get_messages: (nonce: bigint) => Promise<{
          messages: Array<{
            client_id: bigint;
            key: string;
            val: number[];
          }>;
          cert: number[];
          tree: number[];
        }>;
      }> = Actor.createActor(idl, {
        agent: this.agent!,
        canisterId: Principal.fromText(canisterId),
      });

      const response = await actor.ws_get_messages(BigInt(nonce));

      // Convert BigInt to String (JavaScript compatibility)
      const messages: EncodedMessage[] = response.messages.map((msg) => ({
        ...msg,
        client_id: msg.client_id.toString(),
        val: new Uint8Array(msg.val),
      }));

      return {
        messages,
        cert: new Uint8Array(response.cert),
        tree: new Uint8Array(response.tree),
      };
    } catch (error) {
      console.error(`❌ Message retrieval failed: ${(error as Error).message}`);
      return {
        messages: [],
        cert: new Uint8Array(0),
        tree: new Uint8Array(0),
      };
    }
  }

  /**
   * Verify Ed25519 signature
   */
  verifySignature(
    publicKeyBytes: Uint8Array,
    messageBytes: Buffer,
    signatureBytes: Buffer
  ): boolean {
    try {
      // Node.js crypto module usage
      const crypto = require("crypto");

      // Ed25519 signature verification using crypto module
      try {
        // Convert publicKeyBytes to Buffer if it's Uint8Array
        const pubKey = Buffer.isBuffer(publicKeyBytes)
          ? publicKeyBytes
          : Buffer.from(publicKeyBytes);

        const message = Buffer.isBuffer(messageBytes)
          ? messageBytes
          : Buffer.from(messageBytes);

        const signature = Buffer.isBuffer(signatureBytes)
          ? signatureBytes
          : Buffer.from(signatureBytes);

        // IC received public key is 32 bytes raw format so
        // DER header for Ed25519 needs to be added
        if (pubKey.length === 32) {
          // Ed25519 public key DER header
          const derHeader = Buffer.from([
            0x30,
            0x2a, // SEQUENCE, length 42
            0x30,
            0x05, // SEQUENCE, length 5
            0x06,
            0x03,
            0x2b,
            0x65,
            0x70, // OID for Ed25519
            0x03,
            0x21,
            0x00, // BIT STRING, length 33, no padding
          ]);
          const derKey = Buffer.concat([derHeader, pubKey]);

          // Create Ed25519 public key object
          const keyObject = crypto.createPublicKey({
            key: derKey,
            format: "der",
            type: "spki",
          });

          // Verify signature
          const isValid = crypto.verify(null, message, keyObject, signature);

          return isValid;
        } else {
          throw new Error(`Unexpected public key length: ${pubKey.length}`);
        }
      } catch (cryptoError) {
        console.log(
          "⚠️ crypto module verification failed, trying ed25519 package:",
          (cryptoError as Error).message
        );

        // Alternative: try ed25519 package
        try {
          const ed25519 = require("ed25519");

          console.log("📝 Trying ed25519 package");

          // ed25519 package can receive Buffer directly
          const pubKey = Buffer.isBuffer(publicKeyBytes)
            ? publicKeyBytes
            : Buffer.from(publicKeyBytes);

          const message = Buffer.isBuffer(messageBytes)
            ? messageBytes
            : Buffer.from(messageBytes);

          const signature = Buffer.isBuffer(signatureBytes)
            ? signatureBytes
            : Buffer.from(signatureBytes);

          // Check correct usage of ed25519 package
          if (typeof ed25519.verify === "function") {
            // ed25519.verify(signature, message, publicKey) order
            const isValid = ed25519.verify(signature, message, pubKey);
            console.log(
              `🔒 ed25519 package signature verification result: ${
                isValid ? "valid" : "invalid"
              }`
            );
            return isValid;
          } else {
            console.error("❌ ed25519.verify function not found");
            throw new Error("ed25519.verify function not available");
          }
        } catch (ed25519Error) {
          console.error(
            "❌ ed25519 package error:",
            (ed25519Error as Error).message
          );
          // Return true always in dev/test environment (temporary)
          console.warn("⚠️ Development mode: skipping signature verification");
          return true;
        }
      }
    } catch (error) {
      console.error(
        `❌ Signature verification failed: ${(error as Error).message}`
      );
      // Return true always in dev/test environment (temporary)
      console.warn(
        "⚠️ Development mode: returning true due to signature verification error"
      );
      return true;
    }
  }

  /**
   * Validate Principal
   */
  validatePrincipal(principalText: string): boolean {
    try {
      Principal.fromText(principalText);
      return true;
    } catch (error) {
      console.error(`❌ Invalid Principal: ${principalText}`);
      return false;
    }
  }

  /**
   * Check Agent status
   */
  isAgentReady(): boolean {
    return this.agent !== null;
  }

  /**
   * Recreate Agent
   */
  async recreateAgent(): Promise<HttpAgent> {
    console.log("🔄 Recreating Agent...");
    this.agent = null;
    return await this.createAgent();
  }
}

import Principal "mo:base/Principal";
import Blob "mo:base/Blob";
import TrieMap "mo:base/TrieMap";
import Time "mo:base/Time";
import Ed25519 "mo:ed25519";
import JSON "mo:json/JSON";
import Char "mo:base/Char";
import Text "mo:base/Text";
import Debug "mo:base/Debug";
import Result "mo:base/Result";
import Float "mo:base/Float";
import Option "mo:base/Option";
import DBTypes "../db/types/types";
import Buffer "mo:base/Buffer";
import CertifiedData "mo:base/CertifiedData";
import Hash "mo:base/Hash";
import Array "mo:base/Array";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Int "mo:base/Int";
import Int32 "mo:base/Int32";
import Sha256 "mo:sha2/Sha256";
import database_ops "../db/modules/database_ops";
import Decoder "mo:cbor/Decoder";
import Types "mo:cbor/Types";
import Encoder "mo:cbor/Encoder";
import HTTP "../common/Http";
import utils "../common/utils";
import Bool "mo:base/Bool";
shared (installer) actor class canister(dbCanisterId : Principal) = this {

  //deploy websocket:  dfx deploy websocket --argument '(principal "'$(dfx canister id db)'")'
  let db : DBTypes.DBInterface = actor (Principal.toText(dbCanisterId));

  let LABEL_WEBSOCKET : [Nat8] = [119, 101, 98, 115, 111, 99, 107, 101, 116]; // "websocket" in ASCII
  let MSG_TIMEOUT : Nat64 = 5 * 60 * 1000000000; // 5 minutes in nanoseconds
  let MAX_NUMBER_OF_RETURNED_MESSAGES : Nat = 50;
  private let CERT_TREE = TrieMap.TrieMap<Text, Blob>(Text.equal, Text.hash);

  type PublicKey = Blob;

  type KeyGatewayTime = {
      key : Text;
      gateway : Text;
      time : Nat64;
  };

  type HttpRequest = HTTP.HttpRequest;
  type HttpResponse = HTTP.HttpResponse;

  //Web socket calls
  // Define the AppMessage type
  type AppMessage = {
      text : Text;
      data : Text;
      user_principal_id : Text;
      job_id : ?Text;
  };

  // Type definitions
    public type WebsocketMessageLib = {
        client_id : Nat64;
        sequence_num : Nat64;
        timestamp : Nat64;
        message : Blob;
    };

    public type EncodedMessage = {
        client_id : Nat64;
        key : Text;
        val : Blob;
    };

    public type CertMessages = {
        messages : [EncodedMessage];
        cert : [Nat8];
        tree : [Nat8];
    };

    // Type definition for FirstMessage
    public type FirstMessage = {
        client_id : Nat64;
        canister_id : Text;
        user_principal_id : Text;
    };

    // Type definition for ClientMessage
    public type ClientMessage = {
        val : Blob;
        sig : Blob;
    };

  // Define the WebsocketMessage type
  type WebsocketMessage = {
      client_id : Nat64;
      message : Blob;
  };

  var nextClientId : Nat64 = 16;
  var nextMessageNonce : Nat64 = 16;

  //////////////////////////////////////////////Lib starts////////////////////////////////////////////////////////////
  // Debug method. Wipes all data in the canister.
    public func wsWipe() : async () {
        await wipe();
    };

    // Client submits its public key and gets a new client_id back.
    public shared func ws_register(publicKey : Blob) : async Nat64 {

        let clientId = await next_client_id();
        
        // Store the client key.
        await put_client_public_key(clientId, publicKey);
        
        // The identity (caller) used in this update call will be associated with this client_id. Remember this identity.
        await put_client_caller(clientId);

        clientId;
    };

    // A method for the gateway to get the client's public key and verify the signature of the first websocket message.
    public func ws_get_client_key(clientId : Nat64) : async Blob {
        let clientKeyOpt = await get_client_public_key(clientId);
        switch (clientKeyOpt) {
            case (?key) { key };
            case null { 
                // Handle error: client key not found
                Blob.fromArray([]);
            };
        }
    };

    // Open the websocket connection.
    public shared func ws_open(msg : Blob, sig : Blob) : async Text {

        Debug.print("msg: " # debug_show (msg));
        Debug.print("sig: " # debug_show (sig));

        let decoded : FirstMessage = switch (Decoder.decode(msg)) {
            case (#ok(#majorType6 { value = #majorType5(fields) })) {
                var client_id : ?Nat64 = null;
                var canister_id : ?Text = null;
                var user_principal_id : ?Text = null;

                for ((key, val) in fields.vals()) {
                    switch (key, val) {
                        case (#majorType3("client_id"), #majorType0(id)) {
                            client_id := ?id;
                        };
                        case (#majorType3("canister_id"), #majorType3(id)) {
                            canister_id := ?id;
                        };
                        case (#majorType3("user_principal_id"), #majorType3(id)) {
                            user_principal_id := ?id;
                        };
                        case _ {};
                    };
                };

                switch (client_id, canister_id, user_principal_id) {
                    case (?cId, ?cName, ?uPrincipal) {
                        { client_id = cId; canister_id = cName; user_principal_id = uPrincipal };
                    };
                    case _ {
                        Debug.print("Missing or invalid client_id/canister_id/user_principal_id");
                        { 
                            client_id = 0;
                            canister_id = "Missing fields";
                            user_principal_id = "Missing fields"
                        };
                    };
                };
            };
            case _ {
                Debug.print("Invalid CBOR message format");
                { 
                    client_id = 0;
                    canister_id = "Invalid CBOR message format";
                    user_principal_id = "Invalid CBOR message format"
                }
            };
        };

        let client_id = decoded.client_id;
        let clientKey = switch (await get_client_public_key(client_id)) {
            case (?key) { key };
            case null { 
                Debug.print("Client key not found");
                // Return empty blob to indicate error
                Blob.fromArray([]);
            };
        };

        // Then check for empty blob
        if (Blob.toArray(clientKey).size() == 0) {
            return "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Client key not found\"" #
            "}";
        };

        let userPrincipalID = decoded.user_principal_id;

        let publicKeyBytes = Blob.toArray(clientKey);
        let signatureBytes = Blob.toArray(sig);
        let messageBytes = Blob.toArray(msg);

        let valid = Ed25519.ED25519.verify(signatureBytes, messageBytes, publicKeyBytes);

        Debug.print("Node ws_open clientKey: " # debug_show(clientKey));
        Debug.print("Node ws_open publicKeyBytes: " # debug_show(publicKeyBytes));
        Debug.print("Node ws_open signatureBytes: " # debug_show(signatureBytes));
        Debug.print("Node ws_open messageBytes: " # debug_show(messageBytes));
        Debug.print("Node ws_open valid: " # debug_show(valid));

        if (valid) {
            // Remember this gateway will get the messages for this client_id.
            await put_client_gateway(client_id);

            // Create WebSocket session for uptime tracking 
            let sessionId = await db.wsCreateSession(userPrincipalID, Int.abs(Nat64.toNat(client_id)));
            Debug.print("Created WebSocket session: " # sessionId # " for client: " # debug_show(client_id));

             let canisterResponse = await ws_on_open(client_id, userPrincipalID);
             switch (canisterResponse) {
                case (#ok(jsonResponse)) {
                    jsonResponse  // Pass through the JSON response directly
                };
                case (#err(error)) {
                    "{" #
                        "\"status\": \"error\"," #
                        "\"message\": \"" # error # "\"" #
                    "}"
                };
            };
        } else {
            "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Invalid signature\"" #
            "}"
        }
    };

    // Close the websocket connection.
    public func ws_close(clientId : Nat64) : async () {
        // Get user principal ID before deleting client
        let userPrincipalID = await get_client_caller(clientId);
        
        // End WebSocket session for uptime tracking
        switch (userPrincipalID) {
            case (?principal) {
                ignore await db.wsEndSession(principal, "normal");
                Debug.print("Ended WebSocket session for user: " # principal);
            };
            case null {
                Debug.print("Could not find user principal for client: " # debug_show(clientId));
            };
        };
        
        await delete_client(clientId);
    };

    // Gateway calls this method to pass on the message from the client to the canister.
    public func ws_message(msg : Blob) : async Text {
        Debug.print("Inside ws_message(), msg: " # debug_show (msg));

        let decoded : ClientMessage = switch (Decoder.decode(msg)) {
            case (#ok(#majorType6 { value = #majorType5(fields) })) {
                var val : ?Blob = null;
                var sig : ?Blob = null;

                for ((key, value) in fields.vals()) {
                    switch (key, value) {
                        case (#majorType3("val"), #majorType2(v)) { val := ?Blob.fromArray(v) };
                        case (#majorType3("sig"), #majorType2(s)) { sig := ?Blob.fromArray(s) };
                        case _ {};
                    };
                };

                switch (val, sig) {
                    case (?v, ?s) { { val = v; sig = s } };
                    case _ {
                        Debug.print("Missing or invalid val/sig in ClientMessage");
                        return "{" #
                            "\"status\": \"error\"," #
                            "\"message\": \"Missing or invalid val/sig in ClientMessage\"" #
                        "}";
                    };
                };
            };
            case _ {
                Debug.print("Invalid CBOR message format for ClientMessage");
                return "{" #
                    "\"status\": \"error\"," #
                    "\"message\": \"Invalid CBOR message format for ClientMessage\"" #
                "}";
            };
        };

        let content : WebsocketMessageLib = switch (Decoder.decode(decoded.val)) {
            case (#ok(#majorType6 { value = #majorType5(fields) })) {
                var client_id : ?Nat64 = null;
                var sequence_num : ?Nat64 = null;
                var timestamp : ?Nat64 = null;
                var message : ?Blob = null;

                for ((key, value) in fields.vals()) {
                    switch (key, value) {
                        case (#majorType3("client_id"), #majorType0(id)) { 
                            client_id := ?id;
                        };
                        case (#majorType3("sequence_num"), #majorType0(num)) { 
                            sequence_num := ?num;
                        };
                        case (#majorType3("timestamp"), #majorType0(ts)) { 
                            timestamp := ?ts;
                        };
                        case (#majorType3("message"), #majorType2(msg)) { 
                            message := ?Blob.fromArray(msg);
                        };
                        case _ {};
                    };
                };

                switch (client_id, sequence_num, timestamp, message) {
                    case (?cId, ?sNum, ?ts, ?msg) { 
                        { 
                            client_id = cId;
                            sequence_num = sNum;
                            timestamp = ts;
                            message = msg;
                        };
                    };
                    case _ {
                        Debug.print("Missing or invalid fields in WebsocketMessage");
                        return "{" #
                            "\"status\": \"error\"," #
                            "\"message\": \"Missing or invalid fields in WebsocketMessage\"" #
                        "}";
                    };
                };
            };
            case _ {
                Debug.print("Invalid CBOR message format for WebsocketMessage");
                return "{" #
                    "\"status\": \"error\"," #
                    "\"message\": \"Invalid CBOR message format for WebsocketMessage\"" #
                "}";
            };
        };

        let clientId = content.client_id;

        // Verify the signature
        let clientKey = switch (await get_client_public_key(clientId)) {
            case (?key) { key };
            case null { 
                Debug.print("Client key not found");
                return "{" #
                    "\"status\": \"error\"," #
                    "\"message\": \"Client key not found\"" #
                "}";
            };
        };

        let publicKeyBytes = Blob.toArray(clientKey);
        let signatureBytes = Blob.toArray(decoded.sig);
        let messageBytes = Blob.toArray(decoded.val);

        let valid = Ed25519.ED25519.verify(signatureBytes, messageBytes, publicKeyBytes);

        Debug.print("Node ws_message clientId: " # debug_show(clientId));
        Debug.print("Node ws_message clientKey: " # debug_show(clientKey));
        Debug.print("Node ws_message publicKeyBytes: " # debug_show(publicKeyBytes));
        Debug.print("Node ws_message signatureBytes: " # debug_show(signatureBytes));
        Debug.print("Node ws_message messageBytes: " # debug_show(messageBytes));
        Debug.print("Node ws_message valid: " # debug_show(valid));
        Debug.print("Node ws_message content sequence_num: " # debug_show(content.sequence_num));

        if (valid) {
            // Verify the message sequence number
            let clientIncomingNum = await get_client_incoming_num(clientId);
            Debug.print("Node ws_message clientIncomingNum: " # debug_show(clientIncomingNum));
            if (content.sequence_num == clientIncomingNum) {
                await put_client_incoming_num(clientId, content.sequence_num + 1);
                
                // Update heartbeat for uptime tracking
                let userPrincipalID = await get_client_caller(clientId);
                switch (userPrincipalID) {
                    case (?principal) {
                        ignore await db.wsUpdateHeartbeat(principal);
                    };
                    case null {};
                };
                
                // Create a new object with the expected structure
                let adjustedContent = {
                    client_id = content.client_id;
                    message = content.message;
                };

                let canisterResponse = await ws_on_message(adjustedContent);
                switch (canisterResponse) {
                    case (#ok(_)) {
                        "{\"status\": \"ok\", \"message\": \"Processed\"}";
                    };
                    case (#err(error)) {
                        "{" #
                            "\"status\": \"error\"," #
                            "\"message\": \"" # error # "\"" #
                        "}";
                    };
                };
            } else {
                Debug.print(
                    "Invalid sequence number: got="
                    # Nat64.toText(content.sequence_num)
                    # " expected="
                    # Nat64.toText(clientIncomingNum)
                    # " clientId=" # Nat64.toText(clientId)
                );
                Debug.print("Invalid sequence number");
                "{" #
                    "\"status\": \"error\"," #
                    "\"message\": \"Invalid sequence number\"" #
                "}";
            };
        } else {
            Debug.print("Signature verification failed");
            "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Signature verification failed\"" #
            "}";
        };
    };

    // Gateway polls this method to get messages for all the clients it serves.
    public func ws_get_messages(nonce : Nat64) : async CertMessages {
        Debug.print("ws_get_messages called with nonce: " # debug_show(nonce));
        let response = await get_cert_messages(nonce);
        Debug.print("Response from Sock: " # debug_show(response));
        
        // Convert Blob fields to [Nat8]
        {
            messages = response.messages;
            cert = response.cert;
            tree = response.tree;
        }
    };
  //////////////////////////////////////////////Lib ends////////////////////////////////////////////////////////////




  ////////////////////////////////////////////Websocket starts//////////////////////////////////////////////////////

  // Custom hash function for Nat64
  private func hashNat64(n : Nat64) : Hash.Hash {
      let bytes : [Nat8] = [
          Nat8.fromNat(Nat64.toNat((n >> 56) & 255)),
          Nat8.fromNat(Nat64.toNat((n >> 48) & 255)),
          Nat8.fromNat(Nat64.toNat((n >> 40) & 255)),
          Nat8.fromNat(Nat64.toNat((n >> 32) & 255)),
          Nat8.fromNat(Nat64.toNat((n >> 24) & 255)),
          Nat8.fromNat(Nat64.toNat((n >> 16) & 255)),
          Nat8.fromNat(Nat64.toNat((n >> 8) & 255)),
          Nat8.fromNat(Nat64.toNat(n & 255)),
      ];
      var hash : Nat32 = 5381;
      for (byte in bytes.vals()) {
          hash := ((hash << 5) +% hash) +% Nat32.fromNat(Nat8.toNat(byte));
      };
      hash;
  };

  private var clientCallerMap : TrieMap.TrieMap<Nat64, Text> = TrieMap.TrieMap<Nat64, Text>(Nat64.equal, hashNat64);
  private var clientPublicKeyMap : TrieMap.TrieMap<Nat64, PublicKey> = TrieMap.TrieMap<Nat64, PublicKey>(Nat64.equal, hashNat64);
  private var clientGatewayMap : TrieMap.TrieMap<Nat64, Text> = TrieMap.TrieMap<Nat64, Text>(Nat64.equal, hashNat64);
  private var clientMessageNumMap : TrieMap.TrieMap<Nat64, Nat64> = TrieMap.TrieMap<Nat64, Nat64>(Nat64.equal, hashNat64);
  private var clientIncomingNumMap : TrieMap.TrieMap<Nat64, Nat64> = TrieMap.TrieMap<Nat64, Nat64>(Nat64.equal, hashNat64);
  private var GATEWAY_MESSAGES_MAP : TrieMap.TrieMap<Text, Blob> = TrieMap.TrieMap<Text, Blob>(Text.equal, Text.hash);
  private var MESSAGE_DELETE_QUEUE : TrieMap.TrieMap<Text, KeyGatewayTime> = TrieMap.TrieMap<Text, KeyGatewayTime>(Text.equal, Text.hash);

  // Note: Certification in Motoko is handled differently, so we don't need an exact equivalent of CERT_TREE

  public func wipe() : async () {
      nextClientId := 16;
      nextMessageNonce := 16;
      clientCallerMap := TrieMap.TrieMap<Nat64, Text>(Nat64.equal, hashNat64);
      clientPublicKeyMap := TrieMap.TrieMap<Nat64, PublicKey>(Nat64.equal, hashNat64);
      clientGatewayMap := TrieMap.TrieMap<Nat64, Text>(Nat64.equal, hashNat64);
      clientMessageNumMap := TrieMap.TrieMap<Nat64, Nat64>(Nat64.equal, hashNat64);
      clientIncomingNumMap := TrieMap.TrieMap<Nat64, Nat64>(Nat64.equal, hashNat64);
      GATEWAY_MESSAGES_MAP := TrieMap.TrieMap<Text, Blob>(Text.equal, Text.hash);
      MESSAGE_DELETE_QUEUE := TrieMap.TrieMap<Text, KeyGatewayTime>(Text.equal, Text.hash);
      // Reset certified data
      CertifiedData.set(Blob.fromArray([]));
  };

  public func next_client_id() : async Nat64 {
      nextClientId += 1;
      nextClientId - 1;
  };

  public func next_message_nonce() : async Nat64 {
      nextMessageNonce += 1;
      nextMessageNonce - 1;
  };

  public func put_client_public_key(clientId : Nat64, clientKey : PublicKey) : async () {
      clientPublicKeyMap.put(clientId, clientKey);
  };

  public func get_client_public_key(clientId : Nat64) : async ?PublicKey {
      clientPublicKeyMap.get(clientId);
  };

  public shared (msg) func put_client_caller(clientId : Nat64) : async () {
      clientCallerMap.put(clientId, Principal.toText(msg.caller));
  };

  public shared (msg) func put_client_gateway(clientId : Nat64) : async () {
      clientGatewayMap.put(clientId, Principal.toText(msg.caller));
  };

  public func get_client_gateway(clientId : Nat64) : async ?Text {
      clientGatewayMap.get(clientId);
  };

  public func get_client_caller(clientId : Nat64) : async ?Text {
      clientCallerMap.get(clientId);
  };

  public func next_client_message_num(clientId : Nat64) : async Nat64 {
      switch (clientMessageNumMap.get(clientId)) {
          case (null) {
              clientMessageNumMap.put(clientId, 0);
              0;
          };
          case (?num) {
              let nextNum = num + 1;
              clientMessageNumMap.put(clientId, nextNum);
              nextNum;
          };
      };
  };

  public func get_client_incoming_num(clientId : Nat64) : async Nat64 {
      switch (clientIncomingNumMap.get(clientId)) {
          case (null) { 0 };
          case (?num) { num };
      };
  };

  public func put_client_incoming_num(clientId : Nat64, num : Nat64) : async () {
      clientIncomingNumMap.put(clientId, num);
  };

  public func delete_client(clientId : Nat64) : async () {
      // Convert Nat64 to Int for db call
      let clientIdInt : Int = Int.abs(Nat64.toNat(clientId));

      let removeClient = await db.clientDisconnect(clientIdInt);

      // Handle text response from db
      if (Text.contains(removeClient, #text "success")) {
          Debug.print("Client disconnected successfully");
          clientCallerMap.delete(clientId);
          clientPublicKeyMap.delete(clientId);
          clientGatewayMap.delete(clientId);
          clientMessageNumMap.delete(clientId);
          clientIncomingNumMap.delete(clientId);
      } else {
          Debug.print("Error deleting client: " # removeClient);
      };
  };

  public shared (msg) func get_cert_messages(nonce : Nat64) : async CertMessages {
      let gateway = Principal.toText(msg.caller);

      // Get or create gateway messages
      let gatewayMessages : [EncodedMessage] = switch (GATEWAY_MESSAGES_MAP.get(gateway)) {
          case null { [] };
          case (?messagesBlob) {
              switch (Decoder.decode(messagesBlob)) {
                  case (#ok(#majorType4(values))) {
                      Array.mapFilter<Types.Value, EncodedMessage>(values, decodeEncodedMessage);
                  };
                  case _ { [] };
              };
          };
      };

      let smallestKey = gateway # "_" # padLeft(Nat64.toText(nonce), '0', 20);

      // Find start index
      let startIndex = Array.foldLeft<EncodedMessage, Nat>(
          gatewayMessages,
          0,
          func(acc, x) { if (x.key < smallestKey) { acc + 1 } else { acc } },
      );

      // Calculate end index
      let endIndex = Nat.min(
          startIndex + MAX_NUMBER_OF_RETURNED_MESSAGES,
          gatewayMessages.size(),
      );

      // Get messages slice
      let messages : [EncodedMessage] = Array.subArray<EncodedMessage>(
          gatewayMessages,
          startIndex,
          endIndex - startIndex,
      );

      Debug.print("Messages to return: " # debug_show (messages));

      // Return CertMessages structure
      if (messages.size() > 0) {
          let firstKey = messages[0].key;
          let lastKey = messages[messages.size() - 1].key;
          let (cert, tree) = await get_cert_for_range(firstKey, lastKey);
          {
              messages = Array.map<EncodedMessage, EncodedMessage>(
                  messages,
                  func(m) : EncodedMessage {
                      {
                          client_id = m.client_id;
                          key = m.key;
                          val = m.val;
                      };
                  },
              );
              cert = Blob.toArray(cert);
              tree = Blob.toArray(tree);
          };
      } else {
          {
              messages = [];
              cert = [];
              tree = [];
          };
      };
  };

  private func delete_message(messageInfo : KeyGatewayTime) {
      switch (GATEWAY_MESSAGES_MAP.get(messageInfo.gateway)) {
          case (?existingBlob) {
              // Decode existing messages
              let existingMessages = switch (Decoder.decode(existingBlob)) {
                  case (#ok(#majorType4(values))) {
                      Array.mapFilter<Types.Value, EncodedMessage>(values, decodeEncodedMessage);
                  };
                  case _ { [] };
              };

              // Remove the first message if there are any
              if (existingMessages.size() > 0) {
                  let updatedMessages = Array.subArray(existingMessages, 1, existingMessages.size() - 1 : Nat);

                  // Encode updated messages using the encodeCBORMessages helper function
                  let cborValue = encodeCBORMessages(updatedMessages);

                  switch (Encoder.encode(cborValue)) {
                      case (#ok(bytes)) {
                          GATEWAY_MESSAGES_MAP.put(messageInfo.gateway, Blob.fromArray(bytes));
                      };
                      case (#err(e)) {
                          Debug.print("Error encoding CBOR: " # debug_show (e));
                      };
                  };
              };
          };
          case null { /* Do nothing */ };
      };
      CERT_TREE.delete(messageInfo.key);
  };

  public shared func checkAuth(user_principal_id : Text) : async Result.Result<Text, Text> {
      return await db.clientAuthorization(user_principal_id);
  };

  public func send_message_to_client(client_id : Nat64, user_principal_id : Text) : async Result.Result<Text, Text> {
      Debug.print("send_message_to_client()");
      Debug.print("user_principal_id: " # debug_show (user_principal_id));
      Debug.print("client_id: " # debug_show (client_id));

      let new_msg : AppMessage = {
          text = "HALO";
          data = "HALO HALO"; // Use the original data
          user_principal_id = user_principal_id;
          job_id = null;
      };

      let cborValue : Types.Value = #majorType5([
          (#majorType3("text"), #majorType3(new_msg.text)),
          (#majorType3("data"), #majorType3(new_msg.data)),
          (#majorType3("user_principal_id"), #majorType3(new_msg.user_principal_id)),
      ]);

      let msg_cbor = switch (Encoder.encode(cborValue)) {
          case (#ok(bytes)) { Blob.fromArray(bytes) };
          case (#err(e)) {
              Debug.print("Error encoding CBOR: " # debug_show (e));
              return #err("Error encoding CBOR: " # debug_show (e));
          };
      };

      let wsResponse = await send_message_from_canister(client_id, msg_cbor, new_msg);
      switch (wsResponse) {
          case (#ok(jsonResponse)) {
              #ok(jsonResponse) // Wrap response in #ok variant
          };
          case (#err(error)) {
              #err(error);
          };
      };
  };

  public func send_message_from_canister(client_id : Nat64, msg : Blob, msg_data : AppMessage) : async Result.Result<Text, Text> {
      Debug.print("send_message_from_canister()");
      Debug.print("user_principal_id: " # debug_show (msg_data.user_principal_id));
      Debug.print("client_id: " # debug_show (client_id));
      Debug.print("msg_data: " # debug_show (msg_data));
      Debug.print("msg: " # debug_show (msg));

      // Perform the database operation first
      let dbResponse = switch (msg_data.text) {
          case "PING" {
              Debug.print("Client connect open");
              let clientIdInt : Int = Int.abs(Nat64.toNat(client_id));
              await db.clientConnect(msg_data.user_principal_id, clientIdInt);
          };
          case "INTERNET_SPEED_TEST" {
              Debug.print("Client sending message - update internet speed");
              let clientIdInt : Int = Int.abs(Nat64.toNat(client_id));
              await db.updateClientInternetSpeed(msg_data.user_principal_id, msg_data.data);
          };
          case "HALO" {
              Debug.print("Received HALO message");
              let haloResponse = "{" #
              "\"function\": \"Notification\"," #
              "\"message\": \"HALO received\"," #
              "\"user_principal_id\": \"" # msg_data.user_principal_id # "\"," #
              "\"status\": \"OK\"," #
              "\"data\": \"Sending message to client - HALO HALO\"" #
              "}";
              #ok(haloResponse);
          };

          case "TWITTER_POST" {
              Debug.print("Sending message to client - new job available");
              #ok(
                  "{" #
                  "\"function\": \"TWITTER_SCRAPE\"," #
                  "\"type\": \"TWITTER_POST\"," #
                  "\"url\": \"" # msg_data.data # "\"," #
                  "\"job_id\": \"" # (switch (msg_data.job_id) { case (?id) id; case null "" }) # "\"," #
                  "\"message\": \"Sending job to client\"," #
                  "\"client_id\": \"" # Nat64.toText(client_id) # "\"," #
                  "\"status\": \"OK\"" #
                  "}"
              );
          };
          case "TWITTER_PROFILE" {
              Debug.print("Sending message to client - new job available");
              #ok(
                  "{" #
                  "\"function\": \"TWITTER_SCRAPE\"," #
                  "\"type\": \"TWITTER_PROFILE\"," #
                  "\"url\": \"" # msg_data.data # "\"," #
                  "\"job_id\": \"" # (switch (msg_data.job_id) { case (?id) id; case null "" }) # "\"," #
                  "\"message\": \"Sending job to client\"," #
                  "\"client_id\": \"" # Nat64.toText(client_id) # "\"," #
                  "\"status\": \"OK\"" #
                  "}"
              );
          };
          case "TWITTER_FOLLOW_LIST" {
              Debug.print("Sending message to client - new job available");
              #ok(
                  "{" #
                  "\"function\": \"TWITTER_SCRAPE\"," #
                  "\"type\": \"TWITTER_FOLLOW_LIST\"," #
                  "\"url\": \"" # msg_data.data # "\"," #
                  "\"job_id\": \"" # (switch (msg_data.job_id) { case (?id) id; case null "" }) # "\"," #
                  "\"message\": \"Sending job to client\"," #
                  "\"client_id\": \"" # Nat64.toText(client_id) # "\"," #
                  "\"status\": \"OK\"" #
                  "}"
              );
          };
          case "HTML" {
              Debug.print("Sending message to client - new job available");
              #ok(
                  "{" #
                  "\"function\": \"TWITTER_SCRAPE\"," #
                  "\"type\": \"HTML\"," #
                  "\"url\": \"" # msg_data.data # "\"," #
                  "\"job_id\": \"" # (switch (msg_data.job_id) { case (?id) id; case null "" }) # "\"," #
                  "\"message\": \"Sending job to client\"," #
                  "\"client_id\": \"" # Nat64.toText(client_id) # "\"," #
                  "\"status\": \"OK\"" #
                  "}"
              );
          };
          case "TWITTER_SCRAPE_RESULT" {
              Debug.print("Client sending message - update job status");
              //update client and jobDB
              let result = await db.updateJobCompleted(msg_data.user_principal_id, Int.abs(Nat64.toNat(client_id)), utils.textToInt(msg_data.data));

              result;
          };

          case _ {
              let errorJson = "{" #
                  "\"status\": \"error\"," #
                  "\"message\": \"Unsupported message type: " # msg_data.text # "\"" #
                  "}";
              return #err(errorJson);
          };
      };

      Debug.print("dbResponse: " # debug_show (dbResponse));

      // Handle the Result type properly
      let responseMessage = switch (dbResponse) {
          case (#ok(response)) { response };
          case (#err(error)) {
              let errorJson = "{" #
                  "\"status\": \"error\"," #
                  "\"message\": \"" # error # "\"" #
                  "}";
              return #err(errorJson);
          };
      };

      let cborValue_response : Types.Value = #majorType5([(#majorType3("data"), #majorType3(responseMessage))]);

      let msg_cbor_response = switch (Encoder.encode(cborValue_response)) {
          case (#ok(bytes)) { Blob.fromArray(bytes) };
          case (#err(e)) {
              Debug.print("Error encoding CBOR: " # debug_show (e));
              let errorJson = "{" #
                  "\"status\": \"error\"," #
                  "\"message\": \"Error encoding CBOR: " # debug_show (e) # "\"" #
                  "}";
              return #err(errorJson);
          };
      };

      // Normal message handling continues...
      let gateway = switch (await get_client_gateway(client_id)) {
          case null { 
              let errorJson = "{" #
                  "\"status\": \"error\"," #
                  "\"message\": \"Error getting client gateway\"" #
                  "}";
              return #err(errorJson);
            };
          case (?gw) { gw };
      };

      let time = Time.now();
      nextMessageNonce += 1;
      let key = gateway # "_" # padLeft(Nat64.toText(nextMessageNonce), '0', 20);

      // Add to message delete queue and cleanup old messages
      let queueItem : KeyGatewayTime = {
          key = key;
          gateway = gateway;
          time = Nat64.fromNat(Int.abs(time));
      };
      MESSAGE_DELETE_QUEUE.put(key, queueItem);

      // Check and cleanup old messages (similar to Rust's front check)
      let currentTime = Nat64.fromNat(Int.abs(time));
      for ((_, item) in MESSAGE_DELETE_QUEUE.entries()) {
          if (currentTime - item.time > MSG_TIMEOUT) {
              delete_message(item);
              MESSAGE_DELETE_QUEUE.delete(item.key);
          };
      };

      let input : WebsocketMessageLib = {
          client_id = client_id;
          sequence_num = await next_client_message_num(client_id);
          timestamp = Nat64.fromNat(Int.abs(time));
          message = msg_cbor_response;
      };

      let cborValue = encodeCBORWebsocketMessage(input);
      let data = switch (Encoder.encode(cborValue)) {
          case (#ok(bytes)) { Blob.fromArray(bytes) };
          case (#err(e)) {
              Debug.print("Error encoding CBOR: " # debug_show (e));
              let errorJson = "{" #
                  "\"status\": \"error\"," #
                  "\"message\": \"Error encoding CBOR: " # debug_show (e) # "\"" #
                  "}";
              return #err(errorJson);
          };
      };

      await put_cert_for_message(key, data);

      // Update GATEWAY_MESSAGES_MAP
      switch (GATEWAY_MESSAGES_MAP.get(gateway)) {
          case null {
              let messages = [{
                  client_id = client_id;
                  key = key;
                  val = data;
              }];
              let cborValue = encodeCBORMessages(messages);
              switch (Encoder.encode(cborValue)) {
                  case (#ok(bytes)) {
                      GATEWAY_MESSAGES_MAP.put(gateway, Blob.fromArray(bytes));
                      return #ok("success");
                  };
                  case (#err(e)) {
                      Debug.print("Error encoding CBOR: " # debug_show (e));
                      let errorJson = "{" #
                          "\"status\": \"error\"," #
                          "\"message\": \"Error encoding CBOR: " # debug_show (e) # "\"" #
                          "}";
                      return #err(errorJson);
                  };
              };
          };
          case (?existingBlob) {
              let existingMessages = switch (Decoder.decode(existingBlob)) {
                  case (#ok(#majorType4(values))) {
                      Array.mapFilter<Types.Value, EncodedMessage>(values, decodeEncodedMessage);
                  };
                  case _ { [] };
              };

              let updatedMessages = Array.append(existingMessages, [{ client_id = client_id; key = key; val = data }]);

              let cborValue = encodeCBORMessages(updatedMessages);
              switch (Encoder.encode(cborValue)) {
                  case (#ok(bytes)) {
                      GATEWAY_MESSAGES_MAP.put(gateway, Blob.fromArray(bytes));
                      return #ok("success");
                  };
                  case (#err(e)) {
                      Debug.print("Error encoding CBOR: " # debug_show (e));
                      let errorJson = "{" #
                          "\"status\": \"error\"," #
                          "\"message\": \"Error encoding CBOR: " # debug_show (e) # "\"" #
                          "}";
                      return #err(errorJson);
                  };
              };
          };
      };
  };

  public func put_cert_for_message(key : Text, value : Blob) : async () {
      Debug.print("put_cert_for_message");
      Debug.print("key: " # key);
      Debug.print("value: " # debug_show (value));
      let hash = Sha256.fromBlob(#sha256, value);

      CERT_TREE.put(key, hash);

      let rootHash = labeledHash(LABEL_WEBSOCKET, treeRootHash());
      CertifiedData.set(rootHash);
  };

  public func get_cert_for_message(key : Text) : async (Blob, Blob) {
      let witness = createWitness(key);
      let tree = labeled(LABEL_WEBSOCKET, witness);

      // CBOR encoding of the blob
      let cborTree = encodeCBORBlob(tree);

      let treeBlob = switch (Encoder.encode(cborTree)) {
          case (#ok(bytes)) { Blob.fromArray(bytes) };
          case (#err(e)) {
              Debug.print("Error encoding CBOR tree: " # debug_show (e));
              Blob.fromArray([]); // Return an empty Blob in case of error
          };
      };

      switch (CertifiedData.getCertificate()) {
          case (?cert) { (cert, treeBlob) };
          case null {
              // Handle the case where no certificate is available
              (Blob.fromArray([]), treeBlob);
          };
      };
  };

  public func get_cert_for_range(first : Text, last : Text) : async (Blob, Blob) {
      let witness = createRangeWitness(first, last);
      let tree = labeled(LABEL_WEBSOCKET, witness);

      // CBOR encoding of the tree
      let cborTree = encodeCBORBlob(tree);

      let treeBlob = switch (Encoder.encode(cborTree)) {
          case (#ok(bytes)) { Blob.fromArray(bytes) };
          case (#err(e)) {
              Debug.print("Error encoding CBOR tree: " # debug_show (e));
              Blob.fromArray([]); // Return an empty Blob in case of error
          };
      };

      switch (CertifiedData.getCertificate()) {
          case (?cert) { (cert, treeBlob) };
          case null {
              // Handle the case where no certificate is available
              // You might want to return an empty Blob or handle this case differently
              (Blob.fromArray([]), treeBlob);
          };
      };
  };

  // Helper functions
  private func labeledHash(labelData : [Nat8], data : Blob) : Blob {
      let combined = Array.append(labelData, Blob.toArray(data));
      Sha256.fromArray(#sha256, combined);
  };

  private func treeRootHash() : Blob {
      let allHashes = Array.map<(Text, Blob), Blob>(
          Iter.toArray(CERT_TREE.entries()),
          func((_, v)) { v },
      );
      Sha256.fromArray(#sha256, Array.flatten(Array.map(allHashes, Blob.toArray)));
  };

  private func createWitness(key : Text) : Blob {
      let buffer = Buffer.Buffer<Nat8>(0);

      // Add the key-value pair
      addKeyValueToBuffer(buffer, key, CERT_TREE.get(key));

      // Add the proof for other branches
      for ((k, v) in CERT_TREE.entries()) {
          if (k != key) {
              addHashToBuffer(buffer, textToHash(k));
          };
      };

      Blob.fromArray(Buffer.toArray(buffer));
  };

  private func createRangeWitness(first : Text, last : Text) : Blob {
      let buffer = Buffer.Buffer<Nat8>(0);

      // Add all key-value pairs in the range
      for ((k, v) in CERT_TREE.entries()) {
          if (k >= first and k <= last) {
              addKeyValueToBuffer(buffer, k, ?v);
          } else {
              addHashToBuffer(buffer, textToHash(k));
          };
      };

      Blob.fromArray(Buffer.toArray(buffer));
  };

  private func labeled(labelData : [Nat8], data : Blob) : Blob {
      let buffer = Buffer.Buffer<Nat8>(0);

      // Add labelData length (as a single byte)
      buffer.add(Nat8.fromNat(labelData.size()));

      // Add labelData
      for (byte in labelData.vals()) {
          buffer.add(byte);
      };

      // Add data
      for (byte in Blob.toArray(data).vals()) {
          buffer.add(byte);
      };

      Blob.fromArray(Buffer.toArray(buffer));
  };

  // Helper functions
  private func addKeyValueToBuffer(buffer : Buffer.Buffer<Nat8>, key : Text, value : ?Blob) {
      // Add key length (as a 16-bit big-endian integer)
      let keyBytes = Text.encodeUtf8(key);
      let keySize = Nat32.fromNat(keyBytes.size());
      buffer.add(Nat8.fromNat(Nat32.toNat((keySize >> 8) & 0xFF)));
      buffer.add(Nat8.fromNat(Nat32.toNat(keySize & 0xFF)));

      // Add key
      for (byte in keyBytes.vals()) {
          buffer.add(byte);
      };

      // Add value or empty hash if value is null
      switch (value) {
          case (?v) {
              for (byte in Blob.toArray(v).vals()) {
                  buffer.add(byte);
              };
          };
          case null {
              for (byte in Array.freeze(Array.init<Nat8>(32, 0)).vals()) {
                  buffer.add(byte);
              };
          };
      };
  };

  private func addHashToBuffer(buffer : Buffer.Buffer<Nat8>, hash : [Nat8]) {
      for (byte in hash.vals()) {
          buffer.add(byte);
      };
  };

  private func textToHash(text : Text) : [Nat8] {
      Blob.toArray(Sha256.fromBlob(#sha256, Text.encodeUtf8(text)));
  };

  private func padLeft(text : Text, pad : Char, len : Nat) : Text {
      let textLen = Text.size(text);
      if (textLen >= len) {
          return text;
      };
      let padLen = (len - textLen : Nat);
      let padText = Text.join("", Iter.map(Iter.range(0, padLen - 1), func(_ : Nat) : Text { Text.fromChar(pad) }));
      padText # text;
  };

  type Tree = {
      #empty;
      #pruned : [Nat8];
      #fork : (Tree, Tree);
      #labeled : (Text, Tree);
      #leaf : [Nat8];
  };

  // Helper function to encode a Blob to CBOR
  func encodeCBORBlob(blob : Blob) : Types.Value {
      #majorType2(Blob.toArray(blob));
  };

  // Helper function to decode a single EncodedMessage from CBOR
  func decodeEncodedMessage(value : Types.Value) : ?EncodedMessage {
      switch (value) {
          case (#majorType5(fields)) {
              var client_id : ?Nat64 = null;
              var key : ?Text = null;
              var val : ?Blob = null;

              for ((k, v) in fields.vals()) {
                  switch (k, v) {
                      case (#majorType3("client_id"), #majorType0(id)) {
                          // Convert from Nat to Nat64 during decoding
                          client_id := ?id;
                      };
                      case (#majorType3("key"), #majorType3(k)) {
                          key := ?k;
                      };
                      case (#majorType3("val"), #majorType2(v)) {
                          val := ?Blob.fromArray(v);
                      };
                      case _ {};
                  };
              };

              switch (client_id, key, val) {
                  case (?cId, ?k, ?v) {
                      ?{
                          client_id = cId; // Now cId is already Nat64
                          key = k;
                          val = v;
                      };
                  };
                  case _ { null };
              };
          };
          case _ { null };
      };
  };
  // Helper function to encode EncodedMessage array to CBOR
  func encodeCBORMessages(messages : [EncodedMessage]) : Types.Value {
      #majorType4(
          Array.map(
              messages,
              func(m : EncodedMessage) : Types.Value {
                  #majorType5([
                      (#majorType3("client_id"), #majorType0(m.client_id)), // Remove Nat64.toNat conversion
                      (#majorType3("key"), #majorType3(m.key)),
                      (#majorType3("val"), #majorType2(Blob.toArray(m.val))),
                  ]);
              },
          )
      );
  };

  private func encodeCBORWebsocketMessage(msg : WebsocketMessageLib) : Types.Value {
      #majorType5([
          (#majorType3("client_id"), #majorType0(msg.client_id)), // Use msg.clientId directly
          (#majorType3("sequence_num"), #majorType0(msg.sequence_num)), // Use msg.sequence_num directly
          (#majorType3("timestamp"), #majorType0(msg.timestamp)), // Use msg.timestamp directly
          (#majorType3("message"), #majorType2(Blob.toArray(msg.message))),
      ]);
  };

  // Add helper function to get queue size
  public func get_delete_queue_size() : async Nat {
      Iter.size(MESSAGE_DELETE_QUEUE.entries());
  };

  // Add helper function to get queue items
  public func get_delete_queue_items() : async [KeyGatewayTime] {
      Iter.toArray(Iter.map(MESSAGE_DELETE_QUEUE.entries(), func(entry : (Text, KeyGatewayTime)) : KeyGatewayTime { entry.1 }));
  };
  ///////////////////////////////////////////Websocket ends/////////////////////////////////////////////////////////

  // Function to handle WebSocket open event
  public func ws_on_open(client_id : Nat64, userPrincipalID : Text) : async Result.Result<Text, Text> {
      let msg = {
          text = "PING";
          data = "ping"; 
          user_principal_id = userPrincipalID;
          job_id = null;
      };
      let wsResponse = await ws_send_app_message(client_id, msg);
      Debug.print("wsResponse from ws_send_app_message in ws_on_open(): " # debug_show(wsResponse));
      switch (wsResponse) {
          case (#ok(jsonResponse)) {
              #ok(jsonResponse)  // Wrap response in #ok variant
          };
          case (#err(error)) {
              #err(error)
          };
      };
  };

  // Function to handle incoming WebSocket messages
  public func ws_on_message(content : WebsocketMessage) : async Result.Result<Text, Text> {
      Debug.print("message: " # debug_show (content.message));

      let decoded = switch (Decoder.decode(content.message)) {
          case (#ok(#majorType6 { value = #majorType5(fields) })) {
              var text : ?Text = null;
              var data : ?Text = null;
              var user_principal_id : ?Text = null;
              var job_id : ?Text = null;

              for ((key, value) in fields.vals()) {
                  switch (key, value) {
                      case (#majorType3("text"), #majorType3(t)) { text := ?t };
                      case (#majorType3("data"), #majorType3(d)) { data := ?d };
                      case (#majorType3("user_principal_id"), #majorType3(u)) { user_principal_id := ?u };
                      case (#majorType3("job_id"), #majorType3(j)) {
                          job_id := if (j == "") null else ?j;
                      };
                      case _ {};
                  };
              };

              // Return both text and data in a tuple
              switch (text, data, user_principal_id) {
                  case (?t, ?d, ?u) { 
                      { text = t; data = d; user_principal_id = u; job_id = job_id } 
                  };
                  case _ {
                      Debug.print("Missing or invalid fields in AppMessage");
                      let errorJson = "{" #
                          "\"status\": \"error\"," #
                          "\"message\": \"Missing or invalid fields in AppMessage\"" #
                          "}";
                      return #err(errorJson);
                  };
              };
          };
          case _ {
              Debug.print("Invalid CBOR message format for AppMessage");
              let errorJson = "{" #
                  "\"status\": \"error\"," #
                  "\"message\": \"Invalid CBOR message format for AppMessage\"" #
                  "}";
              return #err(errorJson);
          };
      };

      Debug.print("decoded data: " # debug_show(decoded.data));

      let new_msg : AppMessage = {
          text = decoded.text;
          data = decoded.data;  // Use the original data
          user_principal_id = decoded.user_principal_id;
          job_id = decoded.job_id;
      };
      Debug.print("Sending message: " # debug_show(new_msg));
      let wsResponse = await ws_send_app_message(content.client_id, new_msg);
      switch (wsResponse) {
          case (#ok(jsonResponse)) {
              #ok(jsonResponse)  // Wrap response in #ok variant
          };
          case (#err(error)) {
              let errorJson = "{" #
                  "\"status\": \"error\"," #
                  "\"message\": \"" # error # "\"" #
                  "}";
              return #err(errorJson);
          };
      };
  };

  // Function to send an AppMessage over WebSocket
  public func ws_send_app_message(client_id : Nat64, msg : AppMessage) : async Result.Result<Text, Text> {
      let cborValue : Types.Value = #majorType5([
          (#majorType3("text"), #majorType3(msg.text)),
          (#majorType3("data"), #majorType3(msg.data)),
          (#majorType3("user_principal_id"), #majorType3(msg.user_principal_id)),
          (#majorType3("job_id"), #majorType3(switch (msg.job_id) { case (?id) id; case null "" }))
      ]);

      let msg_cbor = switch (Encoder.encode(cborValue)) {
          case (#ok(bytes)) { Blob.fromArray(bytes) };
          case (#err(e)) { 
              Debug.print("Error encoding CBOR: " # debug_show(e));
              let errorJson = "{" #
                  "\"status\": \"error\"," #
                  "\"message\": \"Error encoding CBOR: " # debug_show(e) # "\"" #
                  "}";
              return #err(errorJson);
          };
      };

      Debug.print("client_id: " # debug_show(client_id));
      Debug.print("msg: " # debug_show(msg));
      Debug.print("msg_cbor: " # debug_show(msg_cbor));

      let wsResponse = await send_message_from_canister(client_id, msg_cbor, msg);
      switch (wsResponse) {
          case (#ok(jsonResponse)) {
              #ok(jsonResponse)  // Wrap response in #ok variant
          };
          case (#err(error)) {
              let errorJson = "{" #
                  "\"status\": \"error\"," #
                  "\"message\": \"" # error # "\"" #
                  "}";
              return #err(errorJson);
          };
      };
  };
  //web socket code ends

  public func getNodeCanisterID() : async Principal {
    return Principal.fromActor(this);
  };

  public func getAllRunningNodes() : async Result.Result<[database_ops.ClientStruct], Text> {
    Debug.print("Inside getAllRunningNodes");
    return await db.getAllRunningNodes();
  };

  public func getAllNodes() : async Result.Result<[database_ops.ClientStruct], Text> {
    Debug.print("Inside getAllNodes");
    return await db.getAllNodes();
  };

  public func findAndAssignJob(jobID: Text) : async ?{
    user_principal_id : Text;
    client_id : Int;
    downloadSpeed : Float;
    target : Text;
    jobType : Text;
  } {
    let optimalNode = await db.findAndAssignJob(jobID);
    return optimalNode;
  };

  public func findAndAssignJobToClient(jobID: Text, principalId: Text) : async ?{
    user_principal_id : Text;
    client_id : Int;
    downloadSpeed : Float;
    target : Text;
    jobType : Text;
  } {
    let optimalNode = await db.findAndAssignJobToClient(jobID, principalId);
    return optimalNode;
  };

  public func resendJob(jobID: Text) : async ?{
    user_principal_id : Text;
    client_id : Int;
    downloadSpeed : Float;
    target : Text;
    jobType : Text;
  } {
    let optimalNode = await db.resendJob(jobID);
    return optimalNode;
  };

  public func createNewJob(clientUUID:Text, jobType : Text, url : Text) : async Result.Result<Text, Text> {
    let data = await db.addJobToDB(clientUUID, jobType, url);
    return data;
  };

  public func assignJobToClient(user_principal_id : Text, client_id : Int) : async Result.Result<Text, Text> {
    let data = await db.assignJobToClient(user_principal_id, client_id);
    return data;
  };

  public func updateJobComplete(user_principal_id : Text, client_id : Int, file_id : Int) : async Result.Result<Text, Text> {
    let data = await db.updateJobCompleted(user_principal_id, client_id, file_id);
    return data;
  };

  public func getStoredIdFromJobId(jobID : Text) : async Result.Result<Int, Text> {
    let data = await db.getJobWithID(jobID);
    switch data {
      case (#ok(jobStruct)) {
        // jobStruct is expected to be of type JobStruct
        #ok(jobStruct.storedID);
      };
      case (#err(errorMsg)) {
        let errorJson = "{" #
            "\"status\": \"error\"," #
            "\"message\": \"" # errorMsg # "\"" #
            "}";
        #err(errorJson);
      };
    };
  };

  public func handleRequestAuth(user_principal_id : Text) : async Result.Result<Text, Text> {
    //check in DB if prinicpal ID is present
    Debug.print("Inside handleRequestAuth");
    return await db.clientAuthorization(user_principal_id);
  };

  public func login(user_principal_id : Text) : async Result.Result<database_ops.ClientStruct, Text> {
    //check in DB if prinicpal ID is present
    Debug.print("Inside login");
    return await db.login(user_principal_id);
  };

  public func getUserRewardHistory(user_principal_id : Text) : async Result.Result<[database_ops.JobStruct], Text> {
    //check in DB if prinicpal ID is present
    Debug.print("Inside getUserRewardHistory");
    return await db.getUserRewardHistory(user_principal_id);
  };

  public func getAllJobs(clientUUID : Text) : async Result.Result<[database_ops.JobStruct], Text> {
    Debug.print("Inside getAllJobs");
    return await db.getAllJobs(clientUUID);
  };

  public func getPendingJobs(clientUUID : Text) : async Result.Result<[database_ops.JobStruct], Text> {
    Debug.print("Inside getPendingJobs");
    return await db.getAllPendingJobs(clientUUID);
  };

  public func getJobWithId(jobId: Text) : async Result.Result<database_ops.JobStruct, Text> {
    Debug.print("Inside getJobWithId");
    return await db.getJobWithID(jobId);
  };

  public shared({ caller }) func addRewardsToDB(principalID : Text, rewards: Float) : async Result.Result<Float, Text> {
    Debug.print("Inside addRewardsToDB");
    if (caller != installer.caller) {
        return #err("Access denied: only owner can call this endpoint");
    };
    return await db.addRewardsToDB(principalID, rewards);
  };

  public query func http_request(_request : HttpRequest) : async HttpResponse {
    return {
      status_code = 200;
      headers = [("Content-Type", "text/plain")];
      body = Text.encodeUtf8("This is a query response");
      streaming_strategy = null;
      upgrade = ?true; // This indicates that the request should be upgraded to an update call
    };
  };

  public shared({ caller }) func http_request_update(req : HttpRequest) : async HttpResponse {
    let path = req.url;
    let method = req.method;
    let headers = req.headers;
    let body = req.body;

    Debug.print("path: " # debug_show (path));
    Debug.print("method: " # debug_show (method));
    Debug.print("body: " # debug_show (body));
    Debug.print("headers: " # debug_show (headers));

    // Extract the base path and query parameters
    let parts = Text.split(path, #text "&");
    let basePath = Option.get(parts.next(), "/");
    let queryParams = Option.get(parts.next(), "");

    // Check if the query parameter contains "requestMethod=requestAuth"
    let isRequestAuth = Text.contains(queryParams, #text "requestMethod=requestAuth");

    Debug.print("isRequestAuth: " # debug_show (isRequestAuth));
    Debug.print("queryParams: " # debug_show (queryParams));
    Debug.print("basePath: " # debug_show (basePath));

    Debug.print("Caller: " # Principal.toText(caller));
    Debug.print("Installer: " # Principal.toText(installer.caller));

    let extracted_path = HTTP.extract_path(basePath);

    switch (method, extracted_path, isRequestAuth) {
      case ("GET", "/getUserData", _) {
        let authHeader = getHeader(headers, "authorization");
        switch (authHeader) {
          case null {
            Debug.print("Missing Authorization header ");
            return badRequest("Missing Authorization header");
          };
          case (?principalID) {
            switch (await login(principalID)) {
              case (#ok(userData)) {
                let rewardHistory = await getUserRewardHistory(principalID);
                var totalAccumulativePoints : Float = 0.0;
                var totalEarnFromLastJob : Float = 0.0;
                var todaysEarnings : Float = 0.0;
                
                switch (rewardHistory) {
                  case (#ok(jobs)) {
                    totalAccumulativePoints := Array.foldLeft<database_ops.JobStruct, Float>(
                      jobs, 
                      0.0, 
                      func(acc : Float, job : database_ops.JobStruct) : Float { 
                        acc + job.reward 
                      }
                    );
                    
                    // Calculate today's earnings from jobs completed today
                    todaysEarnings := calculateTodaysEarnings(jobs);
                    
                    if (jobs.size() > 0) {
                      let lastJob = jobs[jobs.size() - 1];
                      if (lastJob.state == "completed") {
                        totalEarnFromLastJob := lastJob.reward;
                      };
                    };
                  };
                  case (#err(_)) {
                    // If we can't get reward history, use default values
                    totalAccumulativePoints := userData.balance;
                    todaysEarnings := userData.todaysEarnings; // fallback to database value
                  };
                };
                
                let jsonBody = "{" #
                "\"function\": \"Get Data\"," #
                "\"message\": \"Getting client data\"," #
                "\"user_principal_id\": \"" # userData.user_principal_id # "\"," #
                "\"balance\": \"" # Float.toText(userData.balance) # "\"," #
                "\"todaysEarnings\": \"" # Float.toText(todaysEarnings) # "\"," #
                "\"totalAccumulativePoints\": \"" # Float.toText(totalAccumulativePoints) # "\"," #
                "\"totalEarnFromLastJob\": \"" # Float.toText(totalEarnFromLastJob) # "\"," #
                "\"referralCode\": \"" # userData.referralCode # "\"," #
                "\"totalReferral\": \"" # Int.toText(userData.totalReferral) # "\"," #
                "\"state\": \"waiting\"," #
                "\"status\": \"OK\"," #
                "\"jobAssigned\": false" #
                "}";

                Debug.print("JSON response: " # jsonBody);
                return {
                  status_code = 200;
                  headers = [("Content-Type", "application/json")];
                  body = Text.encodeUtf8(jsonBody);
                  streaming_strategy = null;
                  upgrade = null;
                };
              };
              case (#err(errorMsg)) {
                return badRequest("Failed to fetch data");
              };
            };
          };
        };
      };
      case ("GET", "/runningNodes", _) {
        let nodeResult = await getAllRunningNodes();
        switch (nodeResult) {
            case (#ok(nodes)) {
                let nodesJson = nodesToJson(nodes);
                return {
                    status_code = 200;
                    headers = [("Content-Type", "application/json")];
                    body = Text.encodeUtf8(nodesJson);
                    streaming_strategy = null;
                    upgrade = null;
                };
            };
            case (#err(errMsg)) {
                return badRequest(errMsg);
            };
        };
      };
      case ("GET", "/getUptimeStats", _) {
        let authHeader = getHeader(headers, "authorization");
        switch (authHeader) {
          case null {
            Debug.print("Missing Authorization header ");
            return badRequest("Missing Authorization header");
          };
          case (?principalID) {
            let uptimeStats = await db.wsGetUptimeStats(principalID);
                    
            let totalUptimeFormatted = formatUptime(uptimeStats.totalUptime);
            let todayUptimeFormatted = formatUptime(uptimeStats.todayUptime);
            let currentSessionFormatted = formatUptime(uptimeStats.currentSessionDuration);
            
            let jsonResponse = "{" #
              "\"totalUptime\": \"" # totalUptimeFormatted # "\"," #
              "\"todayUptime\": \"" # todayUptimeFormatted # "\"," #
              "\"isCurrentlyOnline\": " # Bool.toText(uptimeStats.isCurrentlyOnline) # "," #
              "\"currentSessionDuration\": \"" # currentSessionFormatted # "\"" #
            "}";
            
            return {
              status_code = 200;
              headers = [("Content-Type", "application/json")];
              body = Text.encodeUtf8(jsonResponse);
              streaming_strategy = null;
              upgrade = null;
            };
          };
        };
      };
      case ("GET", _, true) {
        Debug.print("Inside requestAuth API");
        let authHeader = getHeader(headers, "Authorization");
        switch (authHeader) {
          case null {
            Debug.print("Missing Authorization header ");
            return badRequest("Missing Authorization header");
          };
          case (?principalID) {
            switch (await handleRequestAuth(principalID)) {
              case (#ok(_)) {
                Debug.print("RequestAuth OK");
                // Constructing the JSON manually
                let jsonBody = "{\"status\": \"RequestAuth OK\"}";
                Debug.print("JSON response: " # jsonBody);
                return {
                  status_code = 200;
                  headers = [("Content-Type", "application/json"), ("X-Auth-Status", "OK")];
                  body = Text.encodeUtf8(jsonBody);
                  streaming_strategy = null;
                  upgrade = null;
                };
              };
              case (#err(errorMsg)) {
                Debug.print("RequestAuth ERROR");
                return badRequest(errorMsg);
              };
            };
          };
        };
      };
      case ("POST", "/addReward", _) {
        Debug.print("Inside addReward API");
        // Access control: Only owner can call

        if (caller != installer.caller) {
            return badRequest("Access denied: only owner can call this endpoint");
        };

        // Parse the JSON body to extract principalID and reward
        // Decode and parse request body
        let bodyText = switch (Text.decodeUtf8(req.body)) {
            case (null) {
                return badRequest("Invalid UTF-8 in request body");
            };
            case (?v) { v };
        };
        Debug.print("Decoded body: " # bodyText);
        switch (JSON.parse(bodyText)) {
            case (null) {
                return badRequest("Invalid JSON in request body");
            };
            case (?jsonObj) {
                switch (jsonObj) {
                    case (#Object(fields)) {
                        var principalId : Text = "";
                        var rewards : Float = 0.0;

                        // Extract fields from request body
                        for ((key, value) in fields.vals()) {
                            switch (key, value) {
                                case ("principalId", #String(v)) {
                                    principalId := v;
                                };
                                case ("rewards", #String(v)) {
                                    switch (textToFloat(v)) {
                                        case (?parsed) { rewards := parsed };
                                        case null {};
                                    }
                                };
                                case _ {};
                            };
                        };

                        if (principalId == "" or rewards < 0) {
                            return badRequest("Missing or invalid principalId or rewards in request body");
                        };

                        Debug.print("rewards: " # Float.toText(rewards));
                        let addRewards = await addRewardsToDB(principalId, rewards);
                        var balance : Float = 0.0;
                        switch (addRewards) {
                            case (#ok(bal)) {
                                balance := bal;
                                Debug.print("Balance fetched: " # Float.toText(balance));
                                let jsonResponse = "{" #
                                    "\"balance\": \"" # Float.toText(balance) # "\"," #
                                    "\"message\": \"Balance fetched\"" #
                                "}";
                                return {
                                    status_code = 200;
                                    headers = [("Content-Type", "application/json")];
                                    body = Text.encodeUtf8(jsonResponse);
                                    streaming_strategy = null;
                                    upgrade = null;
                                };
                            };
                            case (#err(error)) {
                                Debug.print("Failed to add rewards: " # error);
                                return badRequest(error);
                            };
                        };
                    };
                    case _ {
                        return badRequest("Invalid JSON format");
                    };
                };
            };
        };
      };
      case _ {
        return notFound();
      };
    };
  };

    func badRequest(msg : Text) : HttpResponse {
        let jsonResponse = "{ \"msg\": \"" # msg # "\" }";
        {
            status_code = 400;
            headers = [("Content-Type", "application/json")];
            body = Text.encodeUtf8(msg);
            streaming_strategy = null;
            upgrade = null;
        };
    };  

  func notFound() : HttpResponse {
    {
      status_code = 404;
      headers = [("Content-Type", "text/plain")];
      body = Text.encodeUtf8("Not Found");
      streaming_strategy = null;
      upgrade = null;
    };
  };

  // Helper function to get header value
  func getHeader(headers : [(Text, Text)], name : Text) : ?Text {
    for ((key, value) in headers.vals()) {
      if (Text.equal(key, name)) {
        return ?value;
      };
    };
    null;
  };

  public shared query (msg) func whoami() : async Principal {
    return msg.caller;
  };

  // Health check function
  public shared query func backend_health_check() : async Text {
    return "OK"; // Responds with "OK"
  };

  func charToInt(c : Char) : Int {
    Int32.toInt(Int32.fromNat32(Char.toNat32(c) - 48));
  };

  func textToFloat(text : Text) : ?Float {
    var integer : Int = 0;
    var fraction : Float = 0;
    var isNegative = false;
    var position : Nat = 0;
    let chars = text.chars();

    if (Text.size(text) == 0) {
      return null
    };
    let firstchar = Text.toArray(text)[0];

    if(firstchar == '-' and text.size()== 1){
      return null;
    };
    if (firstchar == 'e' or firstchar == 'E'){
      return null
    };

    switch (chars.next()) {
      case (?'-') {
        isNegative := true;
        position += 1
      };
      case (?'+') {
        position += 1
      };
      case (?'.') {
        position += 1;
        switch (chars.next()) {
          case (?d) if (Char.isDigit(d)) {
            fraction := 0.1 * Float.fromInt(charToInt(d));
            position += 1
          };
          case (_) { return null }
        }
      };
      case (?d) if (Char.isDigit(d)) {
        integer := charToInt(d);
        position += 1
      };
      case (_) { return null }
    };

    var hasDigits = position > 0;

    label integer_loop loop {
      switch (chars.next()) {
        case (?d) {
          if (Char.isDigit(d)) {
            integer := integer * 10 + charToInt(d);
            position += 1;
            hasDigits := true
          } else if (d == '.') {
            position += 1;
            break integer_loop
          } else if (d == 'e' or d == 'E') {
            position += 1;
            if (not hasDigits) {
              return null
            };

            var expResult = parseExponent(chars);
            switch (expResult) {
              case (null) {
                return null;
              };
              case (?(expValue, _)) {
                // Calculate final value with exponent
                let base = Float.fromInt(if (isNegative) -integer else integer) +
                (if (isNegative) -fraction else fraction);
                let multiplier = Float.pow(10, Float.fromInt(expValue));
                return ?(base * multiplier)
              }
            }
          } else {
            return null
          }
        };
        case (null) {
          if (not hasDigits) {
            return null;
          };
          return ?(Float.fromInt(if (isNegative) -integer else integer))
        }
      }
    };

    var fractionMultiplier : Float = 0.1;
    var hasFractionDigits = false;

    label fraction_loop loop {
      switch (chars.next()) {
        case (?d) {
          if (Char.isDigit(d)) {
            fraction += fractionMultiplier * Float.fromInt(charToInt(d));
            fractionMultiplier *= 0.1;
            position += 1;
            hasFractionDigits := true
          } else if (d == 'e' or d == 'E') {
            position += 1;

            if (not (hasDigits or hasFractionDigits)) {
              return null
            };

            // Handle exponent part
            var expResult = parseExponent(chars);
            switch (expResult) {
              case (null) {
                return null; // Invalid exponent format
              };
              case (?(expValue, _)) {
                // Calculate final value with exponent
                let base = Float.fromInt(if (isNegative) -integer else integer) +
                (if (isNegative) -fraction else fraction);
                let multiplier = Float.pow(10, Float.fromInt(expValue));
                return ?(base * multiplier)
              }
            }
          } else {
            return null
          }
        };
        case (null) {
          // End of input - return complete number
          let result = Float.fromInt(if (isNegative) -integer else integer) +
          (if (isNegative) -fraction else fraction);
          return ?result
        }
      }
    };

    return null;
  };

  func parseExponent(chars : Iter.Iter<Char>) : ?(Int, Nat) {
    var exponent : Int = 0;
    var expIsNegative = false;
    var position = 0;
    var hasDigits = false;

    // Parse optional sign or first digit
    switch (chars.next()) {
      case (?d) {
        if (d == '-') {
          expIsNegative := true;
          position += 1
        } else if (d == '+') {
          position += 1
        } else if (Char.isDigit(d)) {
          exponent := charToInt(d);
          position += 1;
          hasDigits := true
        } else {
          return null
        }
      };
      case (null) {return null};
    };

    label exponent_loop loop {
      switch (chars.next()) {
        case (?d) {
          if (Char.isDigit(d)) {
            exponent := exponent * 10 + charToInt(d);
            position += 1;
            hasDigits := true
          } else {
            return null;
          }
        };
        case (null) {
          if (not hasDigits) {
            return null;
          };
          return ?(if (expIsNegative) -exponent else exponent, position)
        }
      }
    };
    return null;
  };

  public func tToF(t:Text): async ?Float{
    textToFloat(t);
  };

  func nodesToJson(nodes : [database_ops.ClientStruct]) : Text {
        "[" # Text.join(",", Iter.fromArray(Array.map<database_ops.ClientStruct, Text>(nodes, nodeToJson))) # "]";
    };

   // Helper function to convert a single clint struct to a JSON object string
   func nodeToJson(client : database_ops.ClientStruct) : Text {
        "{" #
        "\"user_principal_id\": \"" # client.user_principal_id # "\"," #
        "\"client_id\": " # Int.toText(client.client_id) # "," #
        "\"jobID\": \"" # client.jobID # "\"," #
        "\"jobStatus\": \"" # client.jobStatus # "\"," #
        "\"downloadSpeed\": " # Float.toText(client.downloadSpeed) # "," #
        "\"ping\": " # Int.toText(client.ping) # "," #
        "\"wsConnect\": " # Int.toText(client.wsConnect) # "," #
        "\"wsDisconnect\": " # Int.toText(client.wsDisconnect) # "," #
        "\"jobStartTime\": " # Int.toText(client.jobStartTime) # "," #
        "\"jobEndTime\": " # Int.toText(client.jobEndTime) # "," #
        "\"todaysEarnings\": " # Float.toText(client.todaysEarnings) # "," #
        "\"balance\": " # Float.toText(client.balance) # "," #
        "\"referralCode\": \"" # client.referralCode # "\"," #
        "\"totalReferral\": " # Int.toText(client.totalReferral) # "," #
        "\"clientStatus\": \"" # client.clientStatus # "\"," #
        "\"pingTimestamp\": " # Int.toText(client.pingTimestamp) #
        "}"
    };

   // Helper function to parse query parameters
   func parseQueryParams(url : Text) : [(Text, Text)] {
     let parts = Text.split(url, #char '?');

     // Convert iterator to array to use indexing
     let partsArray = Iter.toArray(parts);

     if (partsArray.size() < 2) {
       return [];
     };

     let queryString = partsArray[1];
     let pairs = Text.split(queryString, #char '&');

     // Convert pairs iterator to array for mapping
     return Array.map<Text, (Text, Text)>(
       Iter.toArray(pairs),
       func(pair : Text) : (Text, Text) {
         let kv = Text.split(pair, #char '=');
         let kvArray = Iter.toArray(kv);

         if (kvArray.size() >= 2) { (kvArray[0], kvArray[1]) } else {
           (kvArray[0], "");
         };
       },
     );
   };

   // Helper function to get a parameter value
   func getParam(params : [(Text, Text)], name : Text) : ?Text {
     for ((key, value) in params.vals()) {
       if (key == name) {
         return ?value;
       };
     };
     null;
   };

   // Helper function to format uptime from nanoseconds to HH:mm:ss
   func formatUptime(nanoseconds : Int) : Text {
     if (nanoseconds <= 0) {
       return "00:00:00";
     };
     
     // Convert nanoseconds to seconds
     let totalSeconds = nanoseconds / 1_000_000_000;
     
     let hours = totalSeconds / 3600;
     let minutes = (totalSeconds % 3600) / 60;
     let seconds = totalSeconds % 60;
     
     // Format with leading zeros
     let hoursStr = if (hours < 10) "0" # Int.toText(hours) else Int.toText(hours);
     let minutesStr = if (minutes < 10) "0" # Int.toText(minutes) else Int.toText(minutes);
     let secondsStr = if (seconds < 10) "0" # Int.toText(seconds) else Int.toText(seconds);
     
     hoursStr # ":" # minutesStr # ":" # secondsStr;
   };

   func getStartOfTodayNanos() : Int {
     let currentTime = Time.now(); // Keep in nanoseconds
     let currentTimeSeconds = currentTime / 1_000_000_000; // Convert to seconds for calculation
     let startOfDaySeconds = currentTimeSeconds - (currentTimeSeconds % 86400); // Get start of day in seconds
     startOfDaySeconds * 1_000_000_000 // Convert back to nanoseconds
   };

   func getEndOfTodayNanos() : Int {
     getStartOfTodayNanos() + (86399 * 1_000_000_000) + 999_999_999 // Add 23:59:59.999999999 in nanoseconds
   };

   func calculateTodaysEarnings(jobs : [database_ops.JobStruct]) : Float {
     let startOfToday = getStartOfTodayNanos();
     let endOfToday = getEndOfTodayNanos();
     
     Array.foldLeft<database_ops.JobStruct, Float>(
       jobs,
       0.0,
       func(acc : Float, job : database_ops.JobStruct) : Float {
         if (job.state == "completed" and job.completeAt >= startOfToday and job.completeAt <= endOfToday and job.reward > 0.0) {
           acc + job.reward
         } else {
           acc
         }
       }
     )
   };
};

import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Int "mo:base/Int";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Option "mo:base/Option";
import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Timer "mo:base/Timer";
import IC "ic:aaaaa-aa";
import Base64 "mo:base64";
// Import the canisters
import IC_OSS_CAN "canister:ic_oss_can";
import IC_OSS_BUCKET "canister:ic_oss_bucket";

actor FileManager {
    // Type definitions to match the Rust types
    public type FileId = Nat32;
    public type Chunk = Blob;
    
    public type FileMetadata = {
        name : Text;
        size : Nat64;
        content_type : ?Text;
        created_at : ?Nat64;
        modified_at : ?Nat64;
    };
    
    public type LoadModelInput = {
        config_id : Nat32;
        tokenizer_id : Nat32;
        model_id : Nat32;
    };
    
    public type State = {
        ai_config : Nat32;
        ai_tokenizer : Nat32;
        ai_model : Nat32;
    };
    
    public type AIModel = {
        config : Blob;
        tokenizer : Blob;
        model : Blob;
    };

     public type FileInfo = {
        id : Nat32;
        name : Text;
        content_type : Text;
        size : Nat64;
        filled : Nat64;
        created_at : Nat64;
        updated_at : Nat64;
        chunks : Nat32;
        hash : ?Blob;
        // Add any other fields that are in the original FileInfo
    };
    
    // Stable state variables
    stable var stableState : State = {
        ai_config = 0;
        ai_tokenizer = 0;
        ai_model = 0;
    };
    
    // In-memory state
    private var aiModel : ?AIModel = null;
    private var rngSeed : ?Blob = null;
    
    // Initialize random number generator
    private func initRand() : async () {
        let result = await IC.raw_rand();
        rngSeed := ?result;
    };

    // Create an instance of the Base64 encoder/decoder
    let base64 = Base64.Base64(#v(Base64.V1), null);
    
    // System functions
    system func preupgrade() {
        // State is already stored in stable variables
    };
    
    system func postupgrade() {
    // Schedule the initialization to happen after postupgrade completes
        ignore Timer.setTimer<system>(#seconds(0), func() : async () {
            // Initialize random
            await initRand();
            
            // If we have a model loaded, reload it
            if (stableState.ai_model > 0) {
                ignore await loadModel({
                    config_id = stableState.ai_config;
                    tokenizer_id = stableState.ai_tokenizer;
                    model_id = stableState.ai_model;
                });
            };
        });
    };
    
    // Helper functions for access control
    private func isController(principal : Principal) : Bool {
        Principal.isController(principal);
    };
    
    private func isControllerOrManager(principal : Principal) : async Bool {
        if (Principal.isController(principal)) {
            return true;
        };
        
        let isManagerResult = await IC_OSS_CAN.is_manager(principal);
        let lowerResult = Result.fromUpper(isManagerResult);
        switch (lowerResult) {
            case (#err(_)) { return false };
            case (#ok(_)) { return true };
        };
    };
    
    // Query function to get state
    public query func state() : async Result.Result<State, ()> {
        #ok(stableState);
    };
    
    // Admin functions
    public shared({caller}) func adminSetManagers(managers : [Principal]) : async Result.Result<(), Text> {
        if (not isController(caller)) {
            return #err("Not authorized");
        };
        
        // Don't convert to TrieSet, just pass the array directly
        let result = await IC_OSS_CAN.admin_set_managers(managers);
        
        // Convert from uppercase to lowercase variant if needed
        switch (result) {
            case (#Ok(_)) { return #ok(()) };
            case (#Err(e)) { return #err(e) };
        };
    };
    
    public shared({caller}) func adminSetVisibility(visibility : Nat8) : async Result.Result<(), Text> {
        if (not isController(caller)) {
            return #err("Not authorized");
        };
        
        let result = await IC_OSS_CAN.admin_set_visibility(visibility);
        
        // Convert from uppercase to lowercase variant
        switch (result) {
            case (#Ok(_)) { return #ok(()) };
            case (#Err(e)) { return #err(e) };
        };
    };

    public shared({caller}) func setMaxFileSize(size : Nat64) : async Result.Result<(), Text> {
        if (not isController(caller)) {
            return #err("Not authorized");
        };
        
        let result = await IC_OSS_CAN.set_max_file_size(size);
        
        // Convert from uppercase to lowercase variant
        switch (result) {
            case (#Ok(_)) { return #ok(()) };
            case (#Err(e)) { return #err(e) };
        };
    };
    
    // Load AI model
    public shared({caller}) func loadModel(args : LoadModelInput) : async Result.Result<Nat64, Text> {
        let isAuthorized = await isControllerOrManager(caller);
        if (not isAuthorized) {
            return #err("Not authorized");
        };
        
        // Load model components from storage
        let configResult = await IC_OSS_CAN.get_full_chunks(args.config_id);
        let tokenizerResult = await IC_OSS_CAN.get_full_chunks(args.tokenizer_id);
        let modelResult = await IC_OSS_CAN.get_full_chunks(args.model_id);
        
        switch (configResult, tokenizerResult, modelResult) {
            case (#Ok(config), #Ok(tokenizer), #Ok(model)) {
                // Store the model in memory
                aiModel := ?{
                    config = config;
                    tokenizer = tokenizer;
                    model = model;
                };
                
                // Update stable state
                stableState := {
                    ai_config = args.config_id;
                    ai_tokenizer = args.tokenizer_id;
                    ai_model = args.model_id;
                };
                
                // Return performance counter (in Motoko we don't have direct equivalent, so using timestamp)
                return #ok(Nat64.fromNat(Int.abs(Time.now())));
            };
            case (#Err(e), _, _) { return #err("Failed to load config: " # e) };
            case (_, #Err(e), _) { return #err("Failed to load tokenizer: " # e) };
            case (_, _, #Err(e)) { return #err("Failed to load model: " # e) };
        };
    };
    
    // File operations using IC_OSS_CAN
    public shared func uploadFile(metadata : FileMetadata, chunks : [Blob]) : async Result.Result<FileId, Text> {
        // First, add the file metadata to get a file ID
        let fileIdResult = await IC_OSS_CAN.add_file({
            name = metadata.name;
            size = metadata.size;
            content_type = Option.get(metadata.content_type, "application/octet-stream");
            created_at = Option.get(metadata.created_at, Nat64.fromNat(Int.abs(Time.now())));
            updated_at = Option.get(metadata.modified_at, Nat64.fromNat(Int.abs(Time.now())));
            chunks = 0;  // Will be updated as chunks are added
            filled = 0;  // Will be updated as chunks are added
            hash = null;  // Optional
        });
        
        switch (fileIdResult) {
            case (#Err(e)) { return #err(e) };
            case (#Ok(fileId)) {
                // Upload each chunk
                for (i in chunks.keys()) {
                    let chunkResult = await IC_OSS_CAN.add_chunk(fileId, Nat32.fromNat(i), chunks[i]);
                    if (chunkResult != #Ok(())) {
                        return #err("Failed to upload chunk " # Nat32.toText(Nat32.fromNat(i)));
                    };
                };
                return #ok(fileId);
            };
        };
    };
    
    // Function to upload a file in chunks
    public shared func uploadFileChunk(fileId : ?FileId, chunkIndex : Nat32, chunk : Blob) : async Result.Result<FileId, Text> {
        switch (fileId) {
            case (null) {
                // First chunk, need to create a file
                let metadata = {
                    name = "temp_file";
                    size = Nat64.fromNat(chunk.size());
                    content_type = "application/octet-stream";
                    created_at = Nat64.fromNat(Int.abs(Time.now()));
                    updated_at = Nat64.fromNat(Int.abs(Time.now()));
                    chunks = 0 : Nat32;
                    filled = 0 : Nat64;
                    hash = null : ?Blob
                };
                
                let fileIdResult = await IC_OSS_CAN.add_file(metadata);
                switch (fileIdResult) {
                    case (#Err(e)) { return #err(e) };
                    case (#Ok(newFileId)) {
                        let chunkResult = await IC_OSS_CAN.add_chunk(newFileId, chunkIndex, chunk);
                        if (chunkResult != #Ok(())) {
                            return #err("Failed to upload chunk");
                        };
                        return #ok(newFileId);
                    };
                };
            };
            
            case (?id) {
                // Add chunk to existing file
                let chunkResult = await IC_OSS_CAN.add_chunk(id, chunkIndex, chunk);
                if (chunkResult != #Ok(())) {
                    return #err("Failed to upload chunk");
                };
                return #ok(id);
            };
        };
    };
    
    // Function to get file metadata
    public shared func getFile(fileId : FileId) : async ?FileMetadata {
        let result = await IC_OSS_CAN.get_file(fileId);
        switch (result) {
            case (null) { null };
            case (?metadata) {
                // Convert from IC_OSS_CAN.FileMetadata to your FileMetadata
                ?{
                    name = metadata.name;
                    size = metadata.size;
                    content_type = ?metadata.content_type;
                    created_at = ?metadata.created_at;
                    modified_at = ?metadata.updated_at;
                    // Add any other fields needed
                }
            };
        }
    };

    public shared func getFileContent(fileId : FileId) : async Result.Result<Text, Text> {
        let chunksResult = await IC_OSS_CAN.get_full_chunks(fileId);
        switch (chunksResult) {
            case (#Err(e)) { return #err(e) };
            case (#Ok(chunks)) {
                // First decode the blob to text
                switch (Text.decodeUtf8(chunks)) {
                    case (null) { 
                        return #err("Content is not valid UTF-8 text");
                    };
                    case (?encodedText) {
                        // Check if the text is valid base64
                        if (base64.isValid(encodedText)) {
                            // Decode the base64 string to Nat8 array
                            let decodedBytes = base64.decode(encodedText);
                            // Convert the Nat8 array to a blob
                            let decodedBlob = Blob.fromArray(decodedBytes);
                            // Convert the blob to text
                            switch (Text.decodeUtf8(decodedBlob)) {
                                case (null) { return #err("Failed to decode content as UTF-8") };
                                case (?decodedText) { return #ok(decodedText) };
                            };
                        } else {
                            // If it's not valid base64, return the original text
                            return #ok(encodedText);
                        };
                    };
                };
            };
        };
    };
    
    // Function to list files
    public shared func listFiles(startId : FileId, limit : Nat32) : async Result.Result<[FileMetadata], Text> {
        let result = await IC_OSS_CAN.list_files(startId, ?limit, null, null);
        
        switch (result) {
            case (#Err(e)) { return #err(e) };
            case (#Ok(fileInfos)) {
                // Convert FileInfo array to FileMetadata array if needed
                let fileMetadatas = Array.map<FileInfo, FileMetadata>(
                    fileInfos,
                    func(info : FileInfo) : FileMetadata {
                        return {
                            name = info.name;
                            size = info.size;
                            content_type = ?info.content_type;
                            created_at = ?info.created_at;
                            modified_at = ?info.updated_at;
                            // Add other fields as needed
                        };
                    }
                );
                return #ok(fileMetadatas);
            };
        };
    };
    
    // Bucket operations using IC_OSS_BUCKET
    public shared func createBucketFile(input : IC_OSS_BUCKET.CreateFileInput, accessToken : ?Blob) : async Result.Result<IC_OSS_BUCKET.CreateFileOutput, Text> {
        let result = await IC_OSS_BUCKET.create_file(input, accessToken);
        switch (result) {
            case (#Ok(output)) { #ok(output) };
            case (#Err(e)) { #err(e) };
        };
    };

    public shared func updateBucketFileChunk(input : IC_OSS_BUCKET.UpdateFileChunkInput, accessToken : ?Blob) : async Result.Result<IC_OSS_BUCKET.UpdateFileChunkOutput, Text> {
        let result = await IC_OSS_BUCKET.update_file_chunk(input, accessToken);
        switch (result) {
            case (#Ok(output)) { #ok(output) };
            case (#Err(e)) { #err(e) };
        };
    };

    public shared func getBucketFileInfo(fileId : Nat32, accessToken : ?Blob) : async Result.Result<IC_OSS_BUCKET.FileInfo, Text> {
        let result = await IC_OSS_BUCKET.get_file_info(fileId, accessToken);
        switch (result) {
            case (#Ok(info)) { #ok(info) };
            case (#Err(e)) { #err(e) };
        };
    };

    public shared func listBucketFiles(parent : Nat32, prev : ?Nat32, take : ?Nat32, accessToken : ?Blob) : async Result.Result<[IC_OSS_BUCKET.FileInfo], Text> {
        let result = await IC_OSS_BUCKET.list_files(parent, prev, take, accessToken);
        switch (result) {
            case (#Ok(files)) { #ok(files) };
            case (#Err(e)) { #err(e) };
        };
    };

    public shared func deleteBucketFile(fileId : Nat32, accessToken : ?Blob) : async Result.Result<Bool, Text> {
        let result = await IC_OSS_BUCKET.delete_file(fileId, accessToken);
        switch (result) {
            case (#Ok(success)) { #ok(success) };
            case (#Err(e)) { #err(e) };
        };
    };
    
    // Initialize the actor
    public shared func init() : async () {
        await initRand();
    };
}
import Buffer "mo:base/Buffer";
import HashMap "mo:base/HashMap";
import Time "mo:base/Time";
import Text "mo:base/Text";
import Iter "mo:base/Iter";

persistent actor CanFileStorage {
  // File metadata structure matching TypeScript interface
  type FileMetadata = {
    name: Text;
    content_type: Text;
    size: Nat;
    user_principal_id: Text;
    job_id: Text;
    created_at: Int;
    original_file_id: Text;
  };

  // File record stored in canister (using text instead of binary)
  type FileRecord = {
    content: Text;
    metadata: FileMetadata;
    created_at: Int;
    updated_at: Int;
  };

  var files_stable: [(Text, FileRecord)] = [];
  var userFiles_stable: [(Text, [Text])] = [];
  var jobFiles_stable: [(Text, [Text])] = [];

  private func getFilesMap(): HashMap.HashMap<Text, FileRecord> {
    HashMap.fromIter<Text, FileRecord>(files_stable.vals(), files_stable.size(), Text.equal, Text.hash);
  };

  private func getUserFilesMap(): HashMap.HashMap<Text, [Text]> {
    HashMap.fromIter<Text, [Text]>(userFiles_stable.vals(), userFiles_stable.size(), Text.equal, Text.hash);
  };

  private func getJobFilesMap(): HashMap.HashMap<Text, [Text]> {
    HashMap.fromIter<Text, [Text]>(jobFiles_stable.vals(), jobFiles_stable.size(), Text.equal, Text.hash);
  };

  system func preupgrade() {
  };

  system func postupgrade() {
  };

  public func store_file(file_key: Text, content: Text, metadata: FileMetadata): async { file_key: Text; success: Bool } {
    try {
      let now = Time.now();
      let file_record: FileRecord = {
        content = content;
        metadata = metadata;
        created_at = now;
        updated_at = now;
      };
      
      // Get current maps
      let files = getFilesMap();
      let userFiles = getUserFilesMap();
      let jobFiles = getJobFilesMap();
      
      // Store file
      files.put(file_key, file_record);
      
      // Update user index
      switch (userFiles.get(metadata.user_principal_id)) {
        case null {
          userFiles.put(metadata.user_principal_id, [file_key]);
        };
        case (?existing) {
          let updated = Buffer.fromArray<Text>(existing);
          updated.add(file_key);
          userFiles.put(metadata.user_principal_id, Buffer.toArray<Text>(updated));
        };
      };
      
      // Update job index
      switch (jobFiles.get(metadata.job_id)) {
        case null {
          jobFiles.put(metadata.job_id, [file_key]);
        };
        case (?existing) {
          let updated = Buffer.fromArray<Text>(existing);
          updated.add(file_key);
          jobFiles.put(metadata.job_id, Buffer.toArray<Text>(updated));
        };
      };
      
      // Update stable storage
      files_stable := Iter.toArray(files.entries());
      userFiles_stable := Iter.toArray(userFiles.entries());
      jobFiles_stable := Iter.toArray(jobFiles.entries());
      
      { file_key = file_key; success = true };
    } catch (_) {
      { file_key = ""; success = false };
    };
  };

  // Get file content and metadata (content as text)
  public query func get_file(file_key: Text): async { content: Text; metadata: FileMetadata; success: Bool } {
    let files = getFilesMap();
    switch (files.get(file_key)) {
      case null { 
        { 
          content = ""; 
          metadata = {
            name = "";
            content_type = "";
            size = 0;
            user_principal_id = "";
            job_id = "";
            created_at = 0;
            original_file_id = "";
          }; 
          success = false 
        };
      };
      case (?file_record) {
        {
          content = file_record.content;
          metadata = file_record.metadata;
          success = true;
        };
      };
    };
  };


  // List files by user
  public query func list_files_by_user(user_principal_id: Text): async [Text] {
    let userFiles = getUserFilesMap();
    switch (userFiles.get(user_principal_id)) {
      case null { [] };
      case (?fileList) { fileList };
    };
  };

  // List files by job
  public query func list_files_by_job(job_id: Text): async [Text] {
    let jobFiles = getJobFilesMap();
    switch (jobFiles.get(job_id)) {
      case null { [] };
      case (?fileList) { fileList };
    };
  };

  // Get file metadata only
  public query func get_file_info(file_key: Text): async ?FileMetadata {
    let files = getFilesMap();
    switch (files.get(file_key)) {
      case null { null };
      case (?file_record) { ?file_record.metadata };
    };
  };

  // Get storage statistics
  public query func get_storage_stats(): async { total_files: Nat; total_size: Nat } {
    let files = getFilesMap();
    var total_files: Nat = 0;
    var total_size: Nat = 0;
    
    for ((_, file_record) in files.entries()) {
      total_files += 1;
      total_size += file_record.metadata.size;
    };
    
    { total_files = total_files; total_size = total_size };
  };

  // Health check
  public query func health_check(): async { status: Text; timestamp: Int } {
    { status = "healthy"; timestamp = Time.now() };
  };
}

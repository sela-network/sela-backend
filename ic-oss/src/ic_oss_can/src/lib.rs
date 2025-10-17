pub mod store;
pub mod types;

use candid::{CandidType, Principal};
use std::collections::BTreeSet;
use types::FileMetadata;

use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableBTreeMap,
};
use std::cell::RefCell;
use types::{Chunk, FileId};

// Add these imports to fix the errors
use ic_oss_types::file::{
    CreateFileInput, 
    CreateFileOutput, 
    FileInfo, 
    UpdateFileChunkInput, 
    UpdateFileChunkOutput, 
    UpdateFileInput, 
    UpdateFileOutput
};
use serde_bytes::ByteBuf;

type Memory = VirtualMemory<DefaultMemoryImpl>;

const FS_DATA_MEMORY_ID: MemoryId = MemoryId::new(0);

// Move these thread_local declarations to the top level
thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    // `FS_CHUNKS_STORE` is needed by `ic_oss_fs` macro
    static FS_CHUNKS_STORE: RefCell<StableBTreeMap<FileId, Chunk, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MEMORY_MANAGER.with_borrow(|m| m.get(FS_DATA_MEMORY_ID)),
        )
    );
}

// Now the macro can access FS_CHUNKS_STORE
ic_oss_fs!();

#[ic_cdk::query]
fn is_manager(principal: Principal) -> Result<(), String> {
    if fs::is_manager(&principal) {
        Ok(())
    } else {
        Err("Not a manager".to_string())
    }
}

#[ic_cdk::update]
fn admin_set_managers(managers: BTreeSet<Principal>) -> Result<(), String> {
    fs::set_managers(managers);
    Ok(())
}

/// Sets the visibility of the file system. 0 is public, 1 is private.
/// Only managers can call this method.
#[ic_cdk::update]
fn admin_set_visibility(visibility: u8) -> Result<(), String> {
    fs::set_visibility(visibility);
    Ok(())
}

#[ic_cdk::update]
fn set_max_file_size(size: u64) -> Result<(), String> {
    fs::set_max_file_size(size);
    Ok(())
}

#[ic_cdk::update]
fn add_file(metadata: FileMetadata) -> Result<u32, String> {
    fs::add_file(metadata)
}

#[ic_cdk::update]
fn add_chunk(file_id: u32, chunk_index: u32, chunk_data: Vec<u8>) -> Result<(), String> {
    let now_ms = ic_cdk::api::time() / 1_000_000;
    fs::update_chunk(file_id, chunk_index, now_ms, chunk_data)?;
    Ok(())
}

#[ic_cdk::query]
fn get_file(file_id: u32) -> Option<FileMetadata> {
    fs::get_file(file_id)
}

#[ic_cdk::query]
fn get_full_chunks(file_id: u32) -> Result<Vec<u8>, String> {
    fs::get_full_chunks(file_id)
}

#[cfg(test)]
mod test {
    use ic_stable_structures::{
        memory_manager::{MemoryId, MemoryManager, VirtualMemory},
        DefaultMemoryImpl, StableBTreeMap,
    };
    use std::cell::RefCell;

    use crate::ic_oss_fs;
    use crate::types::{Chunk, FileId, FileMetadata};

    type Memory = VirtualMemory<DefaultMemoryImpl>;

    const FS_DATA_MEMORY_ID: MemoryId = MemoryId::new(0);

    thread_local! {
        static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
            RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

        // `FS_CHUNKS_STORE` is needed by `ic_oss_can::ic_oss_fs` macro
        static FS_CHUNKS_STORE: RefCell<StableBTreeMap<FileId, Chunk, Memory>> = RefCell::new(
            StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(FS_DATA_MEMORY_ID)),
            )
        );
    }

    // need to define `FS_CHUNKS_STORE` before `ic_oss_can::ic_oss_fs!()`
    ic_oss_fs!();

    #[test]
    fn test_ic_oss_fs() {
        let files = fs::list_files(u32::MAX, 2);
        assert!(files.is_empty());

        fs::add_file(FileMetadata {
            name: "f1".to_string(),
            size: 100,
            ..Default::default()
        })
        .unwrap();

        assert!(fs::get_file(0).is_none());
        assert_eq!(fs::get_file(1).unwrap().name, "f1");

        fs::add_file(FileMetadata {
            name: "f2".to_string(),
            size: 100,
            ..Default::default()
        })
        .unwrap();

        fs::add_file(FileMetadata {
            name: "f3".to_string(),
            size: 100,
            ..Default::default()
        })
        .unwrap();

        fs::add_file(FileMetadata {
            name: "f4".to_string(),
            size: 100,
            ..Default::default()
        })
        .unwrap();

        let files = fs::list_files(u32::MAX, 2);
        assert_eq!(
            files.iter().map(|f| f.name.clone()).collect::<Vec<_>>(),
            vec!["f4", "f3"]
        );

        let files = fs::list_files(files.last().unwrap().id, 10);
        assert_eq!(
            files.iter().map(|f| f.name.clone()).collect::<Vec<_>>(),
            vec!["f2", "f1"]
        );
    }
}

ic_cdk::export_candid!();
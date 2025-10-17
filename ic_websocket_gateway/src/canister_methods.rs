use candid::{Decode};
use candid::CandidType;
use ed25519_compact::PublicKey;
use ic_agent::{
    agent::http_transport::ReqwestHttpReplicaV2Transport, export::Principal,
    identity::BasicIdentity, Agent,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(CandidType, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[candid_path("ic_cdk::export::candid")]
pub struct WebsocketMessage {
    pub client_id: u64,
    pub sequence_num: u64,
    pub timestamp: u64,
    #[serde(with = "serde_bytes")]
    pub message: Vec<u8>,
}

#[derive(CandidType, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub struct EncodedMessage {
    pub client_id: u64,
    pub key: String,
    #[serde(with = "serde_bytes")]
    pub val: Vec<u8>,
}

#[derive(CandidType, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub struct CertMessages {
    pub messages: Vec<EncodedMessage>,
    #[serde(with = "serde_bytes")]
    pub cert: Vec<u8>,
    #[serde(with = "serde_bytes")]
    pub tree: Vec<u8>,
}

pub async fn get_new_agent(url: &str, identity: Arc<BasicIdentity>, fetch_key: bool) -> Result<Agent, String> {
    let transport = ReqwestHttpReplicaV2Transport::create(url.to_string())
        .map_err(|e| format!("Failed to create transport: {}", e))?;
    
    let agent = Agent::builder()
        .with_transport(transport)
        .with_arc_identity(identity)
        .build()
        .map_err(|e| format!("Failed to build agent: {}", e))?;

    if fetch_key {
        agent.fetch_root_key()
            .await
            .map_err(|e| format!("Failed to fetch root key: {}", e))?;
    }
    
    Ok(agent)
}

pub async fn ws_get_client_key(
    agent: &Agent,
    canister_id: &Principal,
    client_id: u64,
) -> PublicKey {
    let args = match candid::encode_args((client_id,)) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("Failed to encode client_id {}: {}", client_id, e);
            return PublicKey::from_slice(&[0; 32]).unwrap(); // Or handle differently
        }
    };    

    let res = match agent
        .update(canister_id, "ws_get_client_key")
        .with_arg(&args)
        .call_and_wait()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Failed to call ws_get_client_key: {}", e);
            return PublicKey::from_slice(&[0; 32]).unwrap(); // Or error out
        }
    };

    println!("Fetching public key for client_id: {}", client_id);

    let key_bytes = match Decode!(&res, Vec<u8>) {
        Ok(bytes) => bytes,
        Err(e) => {
            eprintln!("Failed to decode public key from ws_get_client_key: {}", e);
            return PublicKey::from_slice(&[0; 32]).unwrap(); // Or error out
        }
    };
    
    match PublicKey::from_slice(&key_bytes) {
        Ok(pk) => pk,
        Err(e) => {
            eprintln!("Failed to create PublicKey from slice: {}", e);
            return PublicKey::from_slice(&[0; 32]).unwrap(); // Or error out
        }
    }    
}

pub async fn ws_open(agent: &Agent, canister_id: &Principal, msg: Vec<u8>, sig: Vec<u8>) -> String {
    let args = match candid::encode_args((msg, sig)) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("Failed to encode args for ws_open: {}", e);
            return "{\"status\": \"error\", \"message\": \"Encoding error\"}".to_string();
        }
    };
    
    let response = agent
        .update(canister_id, "ws_open")
        .with_arg(args)
        .call_and_wait()
        .await
        .expect("Failed to call ws_open");

    // Convert response to String
    String::from_utf8(response)
        .unwrap_or_else(|_| String::from("{\"status\": \"error\", \"message\": \"Invalid UTF-8 response\"}"))
}

pub async fn ws_close(agent: &Agent, canister_id: &Principal, can_client_id: u64) {
    let args = match candid::encode_args((can_client_id,)) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("Failed to encode args for ws_close: {}", e);
            return;
        }
    };

    let res = match agent
        .update(canister_id, "ws_close")
        .with_arg(args)
        .call_and_wait()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Failed to call ws_close: {}", e);
            return;
        }
    };

    println!(" ws_close res: {:?}", res);

    match Decode!(&res, ()) {
        Ok(_) => (),
        Err(e) => eprintln!("Failed to decode ws_close response: {}", e),
    }
}

pub async fn ws_message(agent: &Agent, canister_id: &Principal, mes: Vec<u8>) -> Result<String, String> {
    let args = candid::encode_args((mes.clone(),)).unwrap();
    println!("Calling ws_message with payload size: {}", mes.len());

    let response = agent
        .update(canister_id, "ws_message")
        .with_arg(args)
        .call_and_wait()
        .await
        .expect("Failed to call ws_message");
    // Convert response to String
    Ok(String::from_utf8(response)
        .unwrap_or_else(|_| String::from("{\"status\": \"error\", \"message\": \"Invalid UTF-8 response\"}")))
}

pub async fn ws_get_messages(agent: &Agent, canister_id: &Principal, nonce: u64) -> CertMessages {
    let args = match candid::encode_args((nonce,)) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("Failed to encode args: {}", e);
            return CertMessages { messages: vec![], cert: vec![], tree: vec![] };
        }
    };

    let res = agent
        .update(canister_id, "ws_get_messages")
        .with_arg(&args)
        .call_and_wait()
        .await;

    match res {
        Ok(r) => match Decode!(&r, CertMessages) {
            Ok(decoded) => decoded,
            Err(e) => {
                eprintln!("Failed to decode CertMessages: {}", e);
                CertMessages { messages: vec![], cert: vec![], tree: vec![] }
            }
        },
        Err(e) => {
            eprintln!("ws_get_messages transport error: {}", e);
            CertMessages { messages: vec![], cert: vec![], tree: vec![] }
        }
    }
}

// pub async fn validate_session(
//     store: &RedisSessionStore,
//     client_id: u64,
//     canister_id: &str
// ) -> bool {
//     match store.get_session(client_id).await {
//         Ok(Some(session)) => session.canister_id == canister_id,
//         _ => false
//     }
// }

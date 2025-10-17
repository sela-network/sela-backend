use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::error::Error;

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionData {
    pub client_id: u64,
    pub canister_id: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone)]
pub struct RedisSessionStore {
    client: redis::Client,
}

impl RedisSessionStore {
    pub fn new(redis_url: &str) -> Result<Self, Box<dyn Error>> {
        let client = redis::Client::open(redis_url)?;
        Ok(Self { client })
    }

    pub async fn save_session(&self, session_id: u64, data: &SessionData) -> Result<(), Box<dyn Error>> {
        let mut conn: redis::aio::Connection = self.client.get_async_connection().await?;
        let serialized: String = serde_json::to_string(data)?;
        let _: () = conn.set_ex(format!("session:{}", session_id), serialized, 86400).await?;
        Ok(())
    }

    pub async fn get_session(&self, session_id: u64) -> Result<Option<SessionData>, Box<dyn Error>> {
        let mut conn = self.client.get_async_connection().await?;
        let data: Option<String> = conn.get(format!("session:{}", session_id)).await?;
        
        match data {
            Some(serialized) => Ok(Some(serde_json::from_str(&serialized)?)),
            None => Ok(None),
        }
    }

    pub async fn remove_session(&self, session_id: u64) -> Result<(), Box<dyn Error>> {
        let mut conn = self.client.get_async_connection().await?;
        let _: () = conn.del(format!("session:{}", session_id)).await?;
        Ok(())
    }
} 
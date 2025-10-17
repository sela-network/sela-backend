import { Actor, HttpAgent, ActorSubclass } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { Ed25519KeyIdentity } from "@dfinity/identity";

// Interface for the canister
export interface ICanFileStorage {
  store_file: (file_key: string, content: string, metadata: any) => Promise<{ file_key: string; success: boolean }>;
  get_file: (file_key: string) => Promise<{ content: string; metadata: any; success: boolean }>;
  list_files_by_user: (user_principal_id: string) => Promise<string[]>;
  list_files_by_job: (job_id: string) => Promise<string[]>;
  get_file_info: (file_key: string) => Promise<any>;
  get_storage_stats: () => Promise<{ total_files: bigint; total_size: bigint }>;
  health_check: () => Promise<{ status: string; timestamp: bigint }>;
}

// Create actor function
export function createCanFileStorageActor(
  canisterId: string,
  agent: HttpAgent
): ICanFileStorage {
  // Create the actor with proper Candid IDL
  const actor: ActorSubclass<ICanFileStorage> = Actor.createActor(
    ({ IDL }: any) => {
      const FileMetadata = IDL.Record({
        name: IDL.Text,
        content_type: IDL.Text,
        size: IDL.Nat,
        user_principal_id: IDL.Text,
        job_id: IDL.Text,
        created_at: IDL.Int,
        original_file_id: IDL.Text,
      });

      return IDL.Service({
        store_file: IDL.Func(
          [IDL.Text, IDL.Text, FileMetadata],
          [IDL.Record({ file_key: IDL.Text, success: IDL.Bool })],
          ['update']
        ),
        get_file: IDL.Func(
          [IDL.Text],
          [IDL.Record({ 
            content: IDL.Text, 
            metadata: FileMetadata, 
            success: IDL.Bool 
          })],
          ['query']
        ),
        list_files_by_user: IDL.Func(
          [IDL.Text],
          [IDL.Vec(IDL.Text)],
          ['query']
        ),
        list_files_by_job: IDL.Func(
          [IDL.Text],
          [IDL.Vec(IDL.Text)],
          ['query']
        ),
        get_file_info: IDL.Func(
          [IDL.Text],
          [IDL.Opt(FileMetadata)],
          ['query']
        ),
        get_storage_stats: IDL.Func(
          [],
          [IDL.Record({ total_files: IDL.Nat, total_size: IDL.Nat })],
          ['query']
        ),
        health_check: IDL.Func(
          [],
          [IDL.Record({ status: IDL.Text, timestamp: IDL.Int })],
          ['query']
        ),
      });
    },
    {
      agent,
      canisterId: Principal.fromText(canisterId),
    }
  );

  return actor;
}


# Example: `upload_js`

[ic-oss](https://github.com/ldclabs/ic-oss) is a decentralized Object Storage Service on the Internet Computer.

`upload_js` is a demonstration project used to show how to implement large file storage in the ICP canister. By using `ic-oss-can` to include the `ic_oss_fs!` macro in your canister, an `fs` module and a set of Candid file system APIs will be automatically generated. You can use the `ic-oss-cli` tool to upload files to the ICP canister.

For more information about `ic-oss-can`, please refer to [ic-oss-can](https://github.com/ldclabs/ic-oss/tree/main/src/ic_oss_can).

## Running the project locally

If you want to test your project locally, you can use the following commands:

Ensure you're using the nightly toolchain, as the IC Rust SDK requires it:
    rustup install nightly
    rustup default nightly
Install the wasm32-unknown-unknown target:
    rustup target add wasm32-unknown-unknown
Install cargo-binutils + wasm-opt (optional for optimizing wasm):
    cargo install cargo-binutils
    rustup component add llvm-tools-preview
Clone the ic-oss Repository
    git clone https://github.com/ldclabs/ic-oss.git

Build the Canister (WASM)
    cd to sela project
    cargo build --target wasm32-unknown-unknown --release --manifest-path ic-oss/src/ic_oss_can/Cargo.toml
    cargo build --target wasm32-unknown-unknown --release --manifest-path ic-oss/src/ic_oss_bucket/Cargo.toml --verbose

    cargo install candid-extractor
    candid-extractor ic-oss/target/wasm32-unknown-unknown/release/ic_oss_can.wasm > ic_oss_can.did
    candid-extractor ic-oss/target/wasm32-unknown-unknown/release/ic_oss_bucket.wasm > ic_oss_bucket.did

    dfx deploy ic_oss_can
    dfx deploy ic_oss_bucket
    dfx deploy ai_canister

    dfx canister metadata ic_oss_can candid:service
    dfx canister metadata ic_oss_bucket candid:service

    echo "VGhpcyBpcyBhIHRlc3QgZmlsZQo=" | base64 -d



```bash
cd examples/upload_js
# Starts the replica, running in the background
dfx start --background

# deploy the canister
dfx deploy ai_canister
# canister: bkyz2-fmaaa-aaaaa-qaaaq-cai

dfx canister call ai_canister state '()'

MYID=$(dfx identity get-principal)
dfx identity new uploader
dfx identity list
mkdir -p debug
dfx identity export uploader > debug/uploader.pem
dfx identity use default
dfx identity get-principal
dfx canister update-settings ai_canister --add-controller $(dfx --identity uploader identity get-principal)
dfx identity use uploader
# principal: pxwer-c66zh-67kvk-sz4vq-ip27m-tysdt-6z6me-cfmdc-vpwq4-ciflt-yqe

dfx canister call ai_canister adminSetManagers "(vec {principal \"$MYID\"; principal \"pxwer-c66zh-67kvk-sz4vq-ip27m-tysdt-6z6me-cfmdc-vpwq4-ciflt-yqe\"})"

dfx canister call ai_canister setMaxFileSize "(10737418240)" # 10GB
dfx canister call ai_canister adminSetVisibility "(1)" # public

//using dfx for small files
dfx canister call bkyz2-fmaaa-aaaaa-qaaaq-cai uploadChunk '(1, blob "...")' --identity uploader

# Create a small JSON config file (1KB)
echo '{"model_name": "test_model", "version": "1.0", "parameters": {"layers": 2, "hidden_size": 128}}' > test_config.json

# Create a medium-sized JSON tokenizer file (10KB)
node -e 'const tokens = {}; for(let i=0; i<500; i++) { tokens["token"+i] = i }; console.log(JSON.stringify({tokens}))' > test_tokenizer.json

# Create a larger binary file to simulate a model (1MB)
dd if=/dev/urandom of=test_model.bin bs=1024 count=1024

node script.cjs

dfx canister call ai_canister adminLoadModel '(record {config_id=1;tokenizer_id=2;model_id=3})'

dfx canister call ai_canister list_files '(0, null, null, null)'
```

## License

Copyright © 2024-2025 [LDC Labs](https://github.com/ldclabs).

Licensed under the MIT License. See [LICENSE](../../LICENSE-MIT) forcc details. 
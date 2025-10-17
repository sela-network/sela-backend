import Principal "mo:base/Principal";
import Time "mo:base/Time";
import _Timer "mo:base/Timer";
import Text "mo:base/Text";
import Int "mo:base/Int";
import Int64 "mo:base/Int64";
import Result "mo:base/Result";
import CanDB "mo:candb/CanDB";
import Error "mo:base/Error";
import Random "../common/utils";
import Entity "mo:candb/Entity";
import Debug "mo:base/Debug";
import Array "mo:base/Array";
import Nat = "mo:base/Nat";
import JSON "mo:json/JSON";
import Float "mo:base/Float";
import Char "mo:base/Char";
import Nat32 "mo:base/Nat32";
import UUID "mo:idempotency-keys/idempotency-keys";
import HashMap "mo:base/HashMap";

import DatabaseOps "../db/modules/database_ops";
import HttpHandler "../common/http_handler";

actor {
    private let DEAD_TIMEOUT : Int = 3_600_000_000_000; // 1 hour in nanoseconds

    type ClientStruct = DatabaseOps.ClientStruct;
    type JobStruct = DatabaseOps.JobStruct;
    type HttpRequest = HttpHandler.HttpRequest;
    type HttpResponse = HttpHandler.HttpResponse;

    public shared func dummyAutoScalingHook(_ : Text) : async Text {
        return "";
    };

    let scalingOptions : CanDB.ScalingOptions = {
        autoScalingHook = dummyAutoScalingHook;
        sizeLimit = #count(1000);
    };

    stable var clientDB = CanDB.init({
        pk = "clientTable";
        scalingOptions = scalingOptions;
        btreeOrder = null;
    });

    stable var jobDB = CanDB.init({
        pk = "jobTable";
        scalingOptions = scalingOptions;
        btreeOrder = null;
    });

    stable var adminDB = CanDB.init({
        pk = "adminTable";
        scalingOptions = scalingOptions;
        btreeOrder = null;
    });

    type UsageEntry = {
        timestamp : Int; // Timestamp in nanoseconds
    };

    type APIKeyData = {
        apiKey : Text;
        usageCount : Nat;
        usageLimit : Nat;
        usageLog : [UsageEntry];
    };

    let USAGE_LIMIT : Nat = 10000;

    private func createClientEntity(user_principal_id : Text, referralCode : Text) : {
        pk : Text;
        sk : Text;
        attributes : [(Text, Entity.AttributeValue)];
    } {
        Debug.print("Attempting to create client entity: ");
        {
            pk = "clientTable";
            sk = user_principal_id;
            attributes = [
                ("user_principal_id", #text(user_principal_id)),
                ("client_id", #int(0)),
                ("jobID", #text("")),
                ("jobStatus", #text("notWorking")),
                ("downloadSpeed", #float(0.0)),
                ("ping", #int(0)),
                ("wsConnect", #int(Time.now())),
                ("wsDisconnect", #int(0)),
                ("jobStartTime", #int(0)),
                ("jobEndTime", #int(0)),
                ("todaysEarnings", #float(0.0)),
                ("balance", #float(0.0)),
                ("referralCode", #text(referralCode)),
                ("totalReferral", #int(0)),
                ("clientStatus", #text("Inactive")),
                ("pingTimestamp", #int(0)),
                ("totalUptime", #int(0)),
                ("dailyUptime", #int(0)),
            ];
        };
    };

    private func createJobEntity(jobId : Text, clientUUID: Text, jobType : Text, url : Text) : {
        pk : Text;
        sk : Text;
        attributes : [(Text, Entity.AttributeValue)];
    } {
        // Create a job entity with default values and the passed jobType and url
        Debug.print("Attempting to create job entity: " # jobId);
        return {
            pk = "jobTable"; // CanDB partition key
            sk = jobId; // Unique job ID (can be generated as a timestamp or counter)
            attributes = [
                ("jobID", #text(jobId)), // Job ID
                ("clientUUID", #text(clientUUID)),
                ("jobType", #text(jobType)), // Job type
                ("target", #text(url)), // Job url (like scrape twitter, etc.)
                ("state", #text("pending")), // Default state is "pending"
                ("user_principal_id", #text("")), // Initially, no client is assigned
                ("assignedAt", #int(0)),
                ("completeAt", #int(0)), // Initially, not completed (can use 0 or null)
                ("reward", #float(0.0)),
            ];
        };
    };

    public shared func addClientToDB(user_principal_id : Text, referralCode : Text) : async Result.Result<Text, Text> {
        Debug.print("Attempting to insert client with user_principal_id: " # user_principal_id);

        try {
            Debug.print("New client");
            let entity = createClientEntity(user_principal_id, referralCode);
            Debug.print("Client entity creation done ");
            await* CanDB.put(clientDB, entity);
            Debug.print("Entity inserted successfully for user_principal_id: " # user_principal_id);
            // Create a JSON response
            let jsonResponse = "{" #
            "\"status\": \"success\"," #
            "\"message\": \"Client successfully inserted\"," #
            "\"user_principal_id\": \"" # user_principal_id # "\"" #
            "\"state\": \"" # "new" # "\"" #
            "}";

            return #ok(jsonResponse);
        } catch (error) {
            Debug.print("Error caught in job insertion: " # Error.message(error));
                let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"" # Error.message(error) # "\"," #
                "\"user_principal_id\": \"" # user_principal_id # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    public shared func addJobToDB(clientUUID: Text, jobType : Text, url : Text) : async Result.Result<Text, Text> {
        let randomGenerator = Random.new();
        let jobId_ = await randomGenerator.next();
        let jobId = "job" # jobId_;
        Debug.print("Attempting to insert job with jobID: " # jobId);

        if (Text.size(jobId) == 0) {
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Invalid input: jobId must not be empty\"" #
                "}";
            return #err(errorJson);
        };

        try {
            // First, check if the user already exists
            let existingjob = CanDB.get(jobDB, { pk = "jobTable"; sk = jobId });

            switch (existingjob) {
                case (?_) {
                    // Job already exists, return an error
                    Debug.print("Job already exists for jobId: " # jobId);
                    let errorJson = "{" #
                        "\"status\": \"error\"," #
                        "\"message\": \"Job already exists\"," #
                        "\"jobId\": \"" # jobId # "\"" #
                        "}";
                    return #err(errorJson);
                };
                case null {
                    // Job doesn't exist, proceed with insertion
                    Debug.print("New job");
                    let entity = createJobEntity(jobId, clientUUID, jobType, url);
                    Debug.print("Job entity creation done ");
                    await* CanDB.put(jobDB, entity);
                    Debug.print("Entity inserted successfully for jobId: " # jobId);
                    return #ok(jobId);
                };
            };
        } catch (error) {
            Debug.print("Error caught in job insertion: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"" # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    public shared func addRewardsToDB(user_principal_id : Text, rewardPoints: Float) : async Result.Result<Float, Text> {
        Debug.print("Request sent by user_principal_id add rewards: " # user_principal_id);
        let clientEntity = CanDB.get(clientDB, { pk = "clientTable"; sk = user_principal_id });
        let balance = switch (clientEntity) {
            case (?entity) {
                switch (Entity.getAttributeMapValueForKey(entity.attributes, "balance")) {
                    case (?(#float(v))) v;
                    case _ 0.0;
                }
            };
            case null 0.0;
        };

        let totalBalance : Float = balance + rewardPoints;
        Debug.print("user_principal_id: " # user_principal_id);
        Debug.print("rewardPoints: " # Float.toText(rewardPoints));
        Debug.print("balance: " # Float.toText(balance));
        Debug.print("totalBalance: " # Float.toText(totalBalance));
        switch (clientEntity) {
            case (?_clientEntity) {
                Debug.print("Client found in DB with user_principal_id: " # user_principal_id);

                let updatedAttributes = [
                    ("balance", #float(totalBalance)),
                ];

                func updateAttributes(attributeMap : ?Entity.AttributeMap) : Entity.AttributeMap {
                    switch (attributeMap) {
                        case null {
                            Entity.createAttributeMapFromKVPairs(updatedAttributes);
                        };
                        case (?map) {
                            Entity.updateAttributeMapWithKVPairs(map, updatedAttributes);
                        };
                    }
                };

                let updateResult = CanDB.update(
                    clientDB,
                    {
                        pk = "clientTable";
                        sk = user_principal_id;
                        updateAttributeMapFunction = updateAttributes;
                    },
                );
                switch (updateResult) {
                    case null {
                        Debug.print("Failed to update client with rewards: " # user_principal_id);
                        let errorJson = "{" #
                            "\"status\": \"error\"," #
                            "\"message\": \"Failed to update client\"" #
                            "}";
                        return #err(errorJson);
                    };
                    case (?_) {
                        return #ok(totalBalance);
                    };
                };
            };
            case null {
                Debug.print("Client does not exist with user_principal_id: " # user_principal_id);
                let errorJson = "{" #
                    "\"status\": \"error\"," #
                    "\"message\": \"Client does not exist\"" #
                    "}";
                return #err(errorJson);
            };
        };
    };

    public shared func updateJobCompleted(user_principal_id : Text, client_id : Int, file_id : Int) : async Result.Result<Text, Text> {
        Debug.print("Request sent by user_principal_id to mark job as completed: " # user_principal_id);
        Debug.print("Attempting to fetch jobID");

        try {
            let clientEntity = CanDB.get(clientDB, { pk = "clientTable"; sk = user_principal_id });
            let jobID = switch (clientEntity) {
                case (?entity) {
                    switch (Entity.getAttributeMapValueForKey(entity.attributes, "jobID")) {
                        case (?(#text(jobID))) jobID;
                        case _ "unknown";
                    };
                };
                case null "unknown";
            };

            let fetchedClientID = switch (clientEntity) {
                case (?entity) {
                    switch (Entity.getAttributeMapValueForKey(entity.attributes, "client_id")) {
                        case (?(#int(clientID))) clientID;
                        case _ 0;
                    };
                };
                case null 0;
            };

            Debug.print("JobID fetched: " # jobID);
            Debug.print("ClientID fetched: " # Int.toText(fetchedClientID));

            if (fetchedClientID != client_id) {
                let errorJson = "{" #
                    "\"status\": \"error\"," #
                    "\"message\": \"ClientID mismatch\"" #
                    "}";
                return #err(errorJson);
            };

            // First, retrieve the job to check its current state
            let jobEntity = CanDB.get(jobDB, { pk = "jobTable"; sk = jobID });

            switch (jobEntity) {
                case (?job) {
                    let currentState = switch (Entity.getAttributeMapValueForKey(job.attributes, "state")) {
                        case (?(#text(s))) s;
                        case _ "unknown";
                    };

                    let assignedAt = switch (Entity.getAttributeMapValueForKey(job.attributes, "assignedAt")) {
                        case (?(#int(v))) v;
                        case _ 0;
                    };

                    if (currentState != "ongoing") {
                        let errorJson = "{" #
                            "\"status\": \"error\"," #
                            "\"message\": \"Job is not in 'ongoing' state\"" #
                            "}";
                        return #err(errorJson);
                    };

                    // Update job state to completed
                    let updatedJobResult = await updateJobState(jobID, user_principal_id, "completed", assignedAt, Time.now());

                    Debug.print("Job state updated to completed: " # jobID);
                    let updateFileId = await updateJobWithStoredFileId(jobID, file_id);
                    switch (updateFileId) {
                        case (#ok()) {
                            Debug.print("Job file ID updated successfully: " # jobID);
                        };
                        case (#err(errorMsg)) {
                            Debug.print("Failed to update job file ID: " # errorMsg);
                        };
                    };

                    switch (updatedJobResult) {
                        case (#ok()) {
                            // Update client state to idle
                            let (jobStartTime, balance, todaysEarnings) = switch (clientEntity) {
                                case (?entity) {
                                    (
                                        switch (Entity.getAttributeMapValueForKey(entity.attributes, "jobStartTime")) {
                                            case (?(#int(v))) v;
                                            case _ 0;
                                        },
                                        switch (Entity.getAttributeMapValueForKey(entity.attributes, "balance")) {
                                            case (?(#float(v))) v;
                                            case _ 0.0;
                                        },
                                        switch (Entity.getAttributeMapValueForKey(entity.attributes, "todaysEarnings")) {
                                            case (?(#float(v))) v;
                                            case _ 0.0;
                                        },
                                    );
                                };
                                case null (0, 0.0, 0.0);
                            };

                            let endTime = Time.now();

                            let currentTime = getCurrentTime();
                            let currentDayStart = getStartOfDay(currentTime);
                            let jobStartDayStart = getStartOfDay(jobStartTime / 1_000_000_000); // Convert nanoseconds to seconds

                            // Calculate the points
                            let timeDifferenceNanos : Int = endTime - jobStartTime;
                            let timeDifferenceSeconds : Float = Float.fromInt(timeDifferenceNanos) / 1_000_000_000;
                            let rewardPoints : Float = 0.012 * timeDifferenceSeconds;
                            let totalBalance : Float = balance + rewardPoints;

                            Debug.print("currentTime: " # debug_show (currentTime));
                            Debug.print("currentDayStart: " # debug_show (currentDayStart));
                            Debug.print("jobStartDayStart: " # debug_show (jobStartDayStart));

                            let newDailyEarnings = if (currentDayStart > jobStartDayStart) {
                                Debug.print("Job crossed into new day, reset earnings to current reward: " # Float.toText(rewardPoints));
                                rewardPoints;
                            } else {
                                Debug.print("Same day, accumulating earnings: " # Float.toText(todaysEarnings) # " + " # Float.toText(rewardPoints));
                                todaysEarnings + rewardPoints;
                            };

                            Debug.print("jobStartTime: " # debug_show (jobStartTime));
                            Debug.print("endTime: " # debug_show (endTime));
                            Debug.print("Job duration (seconds): " # debug_show (timeDifferenceSeconds));
                            Debug.print("Reward points: " # debug_show (rewardPoints));
                            Debug.print("New total balance: " # debug_show (totalBalance));

                            let updatingJobWithRewards = await updateJobStateWithRewards(jobID, rewardPoints);
                            switch (updatingJobWithRewards) {
                                case (#ok()) {
                                    Debug.print("jobDB updated with rewards: ");
                                };
                                case (#err(_)) {
                                    Debug.print("Failed to update jobDB with rewards: ");
                                };
                            };

                            let updatedClientResult = await updateClientStateWithRewards(user_principal_id, "", "notWorking", jobStartTime, endTime, newDailyEarnings, totalBalance);

                            switch (updatedClientResult) {
                                case (#ok()) {
                                    let jsonResponse = "{" #
                                    "\"function\": \"NOTIFICATION\"," #
                                    "\"type\": \"TWITTER_POST\"," #
                                    "\"status\": \"OK\"," #
                                    "\"message\": \"Job marked as completed successfully\"," #
                                    "\"jobId\": \"" # jobID # "\"," #
                                    "\"user_principal_id\": \"" # user_principal_id # "\"," #
                                    "\"client_id\": \"" # Int.toText(client_id) # "\"," #
                                    "\"completedAt\": \"" # Int.toText(Time.now()) # "\"," #
                                    "\"balance\": \"" # Float.toText(totalBalance) # "\"," #
                                    "\"todaysEarning\": \"" # Float.toText(newDailyEarnings) # "\"," #
                                    "\"earning\": \"" # Float.toText(rewardPoints) # "\"" #
                                    "}";
                                    Debug.print("jsonResponse: " # debug_show (jsonResponse));
                                    #ok(jsonResponse);
                                };
                                case (#err(errorMsg)) {
                                    // Job is completed, but client state update failed
                                    let jsonResponse = "{" #
                                    "\"function\": \"NOTIFICATION\"," #
                                    "\"type\": \"TWITTER_POST\"," #
                                    "\"status\": \"partial_success\"," #
                                    "\"message\": \"Job completed but failed to update client state: " # errorMsg # "\"," #
                                    "\"jobId\": \"" # jobID # "\"," #
                                    "\"client_id\": \"" # Int.toText(client_id) # "\"," #
                                    "\"user_principal_id\": \"" # user_principal_id # "\"," #
                                    "\"balance\": \"" # Float.toText(totalBalance) # "\"," #
                                    "\"earning\": \"" # Float.toText(rewardPoints) # "\"" #
                                    "}";
                                    Debug.print("jsonResponse: " # debug_show (jsonResponse));
                                    #ok(jsonResponse);
                                };
                            };
                        };
                        case (#err(errorMsg)) {
                            let errorJson = "{" #
                                "\"status\": \"error\"," #
                                "\"message\": \"Failed to update job state: " # errorMsg # "\"" #
                                "}";
                            return #err(errorJson);
                        };
                    };
                };
                case null {
                    let errorJson = "{" #
                        "\"status\": \"error\"," #
                        "\"message\": \"Job not found\"" #
                        "}";
                    return #err(errorJson);
                };
            };
        } catch (error) {
            Debug.print("Error in updateJobCompleted: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"An unexpected error occurred: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    public query func getJobWithID(jobID : Text) : async Result.Result<JobStruct, Text> {
        Debug.print("Attempting to get job with jobID: " # jobID);

        try {
            let existingJob = CanDB.get(jobDB, { pk = "jobTable"; sk = jobID });

            switch (existingJob) {
                case null {
                    Debug.print("Job not found for jobID: " # jobID);
                    let errorJson = "{" #
                        "\"status\": \"error\"," #
                        "\"message\": \"Job not found\"" #
                        "}";
                    return #err(errorJson);
                };
                case (?entity) {
                    switch (unwrapJobEntity(entity)) {
                        case (?jobStruct) {
                            #ok(jobStruct);
                        };
                        case null {
                            let errorJson = "{" #
                                "\"status\": \"error\"," #
                                "\"message\": \"Error unwrapping job data\"" #
                                "}";
                            return #err(errorJson);
                        };
                    };
                };
            };
        } catch (error) {
            Debug.print("Error in get function: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Failed to get job: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    public func getAllRunningNodes() : async Result.Result<[ClientStruct], Text> {
        Debug.print("Fetching all running nodes");

        try {
            let skLowerBound = ""; // Start of the range for client keys
            let skUpperBound = "~"; // End of the range for client keys
            
            let clientScanResult = CanDB.scan(
                clientDB,
                {
                    skLowerBound = skLowerBound;
                    skUpperBound = skUpperBound;
                    limit = 10000;
                    ascending = null;
                    filter = null;
                },
            );

            let allClients = Array.mapFilter(
                clientScanResult.entities,
                func(entity : { attributes : Entity.AttributeMap; pk : Text; sk : Text }) : ?ClientStruct {
                    switch (unwrapClientEntity(entity)) {
                        case (?clientStruct) ?clientStruct;
                        case null null;
                    }
                },
            );

            // Get current time in seconds
            let nowSeconds = Time.now() / 1_000_000_000;

            // Filter clients with pingTimestamp within the last 12 seconds
            let recentClients = Array.filter<ClientStruct>(
                allClients,
                func (client) {
                    (nowSeconds - client.pingTimestamp) < 12
                }
            );

            Debug.print("Number of nodes: " # debug_show(recentClients.size()));

            if (recentClients.size() == 0) {
                Debug.print("No client found");
                let errorJson = "{" #
                    "\"status\": \"error\"," #
                    "\"message\": \"No clients found\"" #
                    "}";
                return #err(errorJson);
            } else {
                return #ok(recentClients);
            }
        } catch (error) {
            Debug.print("Error in getAllNodes: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Failed to get clients: " # Error.message(error) # "\"" #
                "}";

            return #err(errorJson);
        }
    };

    public func getAllNodes() : async Result.Result<[ClientStruct], Text> {
        Debug.print("Fetching all nodes");

        try {

            let skLowerBound = ""; // Start of the range for client keys
            let skUpperBound = "~"; // End of the range for client keys
            
            let clientScanResult = CanDB.scan(
                clientDB,
                {
                    skLowerBound = skLowerBound;
                    skUpperBound = skUpperBound;
                    limit = 10000;
                    ascending = null;
                    filter = null;
                },
            );

            let allClients = Array.mapFilter(
                clientScanResult.entities,
                func(entity : { attributes : Entity.AttributeMap; pk : Text; sk : Text }) : ?ClientStruct {
                    switch (unwrapClientEntity(entity)) {
                        case (?clientStruct) ?clientStruct;
                        case null null;
                    }
                },
            );
            Debug.print("Number of nodes: " # debug_show(allClients.size()));

            if (allClients.size() == 0) {
                Debug.print("No client found");
                let errorJson = "{" #
                    "\"status\": \"error\"," #
                    "\"message\": \"No clients found\"" #
                    "}";
                return #err(errorJson);
            } else {
                return #ok(allClients);
            }
        } catch (error) {
            Debug.print("Error in getAllNodes: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Failed to get clients: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        }
    };

    public query func getAllJobs(clientUUID : Text) : async Result.Result<[JobStruct], Text> {
        Debug.print("Fetching all jobs");

        try {
            let jobScanResult = CanDB.scan(
                jobDB,
                {
                    skLowerBound = "job";
                    skUpperBound = "job~";
                    limit = 10000;
                    ascending = null;
                    filter = null;
                },
            );

            let allJobs = Array.mapFilter(
                jobScanResult.entities,
                func(entity : { attributes : Entity.AttributeMap; pk : Text; sk : Text }) : ?JobStruct {
                    switch (unwrapJobEntity(entity)) {
                        case (?jobStruct) ?jobStruct;
                        case null null;
                    }
                },
            );

            // Filter jobs by clientUUID
            let filteredJobs = Array.filter<JobStruct>(
                allJobs,
                func(job : JobStruct) : Bool {
                    job.clientUUID == clientUUID
                }
            );

            if (filteredJobs.size() == 0) {
                Debug.print("No jobs found for clientUUID: " # clientUUID);
                let errorJson = "{" #
                    "\"status\": \"error\"," #
                    "\"message\": \"No jobs found for this client\"" #
                    "}";
                return #err(errorJson);
            } else {
                return #ok(filteredJobs);
            }
        } catch (error) {
            Debug.print("Error in getAllJobs: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Failed to get jobs: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        }
    };

    public query func getAllPendingJobs(clientUUID: Text) : async Result.Result<[JobStruct], Text> {
        Debug.print("Fetching pending jobs for client: " # clientUUID);

        try {
            let skLowerBound = "job";
            let skUpperBound = "job~";
            let limit = 10000;
            let ascending = null;

            let { entities } = CanDB.scan(
                jobDB,
                {
                    skLowerBound = skLowerBound;
                    skUpperBound = skUpperBound;
                    limit = limit;
                    ascending = ascending;
                },
            );

            Debug.print("Total entities: " # debug_show (entities.size()));

            // Filter for pending jobs AND matching clientUUID
            let pendingJobs = Array.mapFilter(
                entities,
                func(entity : { attributes : Entity.AttributeMap; pk : Text; sk : Text }) : ?JobStruct {
                    switch (Entity.getAttributeMapValueForKey(entity.attributes, "state")) {
                        case (?(#text(state))) {
                            if (Text.equal(state, "pending")) {
                                switch (unwrapJobEntity(entity)) {
                                    case (?jobStruct) {
                                        if (jobStruct.clientUUID == clientUUID) {
                                            ?jobStruct
                                        } else { null }
                                    };
                                    case null { null };
                                }
                            } else { null };
                        };
                        case _ { null };
                    }
                }
            );

            if (pendingJobs.size() == 0) {
                Debug.print("No pending jobs found for client: " # clientUUID);
                let errorJson = "{" #
                    "\"status\": \"error\"," #
                    "\"message\": \"No pending jobs found for this client\"" #
                    "}";
                return #err(errorJson);
            } else {
                return #ok(pendingJobs);
            }
        } catch (error) {
            Debug.print("Error in pendingJobs: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Failed to get jobs: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        }
    };

    public shared query func getClientWithID(user_principal_id : Text) : async Result.Result<ClientStruct, Text> {
        Debug.print("Attempting to get client with user_principal_id: " # user_principal_id);

        try {
            let existingClient = CanDB.get(clientDB, { pk = "clientTable"; sk = user_principal_id });

            switch (existingClient) {
                case null {
                    Debug.print("Client not found for user_principal_id: " # user_principal_id);
                    let errorJson = "{" #
                        "\"status\": \"error\"," #
                        "\"message\": \"Client not found\"" #
                        "}";
                    return #err(errorJson);
                };
                case (?entity) {
                    switch (unwrapClientEntity(entity)) {
                        case (?clientStruct) {
                            #ok(clientStruct);
                        };
                        case null {
                            let errorJson = "{" #
                                "\"status\": \"error\"," #
                                "\"message\": \"Error unwrapping client data\"" #
                                "}";
                            return #err(errorJson);
                        };
                    };
                };
            };
        } catch (error) {
            Debug.print("Error in get function: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Failed to get user: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    public shared query func clientAuthorization(user_principal_id : Text) : async Result.Result<Text, Text> {
        Debug.print("Attempting to get client with user_principal_id: " # user_principal_id);

        try {
            let existingClient = CanDB.get(clientDB, { pk = "clientTable"; sk = user_principal_id });

            switch (existingClient) {
                case null {
                    Debug.print("Client not found for user_principal_id: " # user_principal_id);
                    let errorJson = "{" #
                        "\"status\": \"error\"," #
                        "\"message\": \"Client not found\"" #
                        "}";
                    return #err(errorJson);
                };
                case (?_) {
                    Debug.print("Client found in DB with user_principal_id: " # user_principal_id);
                    #ok("OK");
                };
            };
        } catch (error) {
            Debug.print("Error in get function: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Failed to get user: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    public shared query func getPendingJobs() : async Result.Result<Text, Text> {
        Debug.print("Received request to fetch pending jobs: ");

        let skLowerBound = "job"; // Start of the range for client keys
        let skUpperBound = "job~"; // End of the range for client keys
        let limit = 10000; // Limit number of records to scan
        let ascending = null; // Not specifying order

        // Use CanDB.scan to retrieve job records
        let { entities } = CanDB.scan(
            jobDB,
            {
                skLowerBound = skLowerBound;
                skUpperBound = skUpperBound;
                limit = limit;
                ascending = ascending;
            },
        );

        Debug.print("Total entities: " # debug_show (entities.size()));

        let pendingJobs = Array.filter(
            entities,
            func(entity : { attributes : Entity.AttributeMap; pk : Text; sk : Text }) : Bool {
                switch (Entity.getAttributeMapValueForKey(entity.attributes, "state")) {
                    case (?(#text(state))) {
                        Debug.print("Job state: " # state);
                        Text.equal(state, "pending");
                    };
                    case _ { false };
                };
            },
        );

        if (pendingJobs.size() == 0) {
            let jsonResponse = "{" #
            "\"status\": \"success\"," #
            "\"message\": \"No pending jobs found in the database\"," #
            "\"count\": 0" #
            "}";
            return #ok(jsonResponse);
        } else {
            // Process pending jobs
            let pendingJobsCount = pendingJobs.size();
            let jsonResponse = "{" #
            "\"status\": \"success\"," #
            "\"message\": \"Pending jobs found\"," #
            "\"count\": " # Nat.toText(pendingJobsCount) #
            "}";
            Debug.print("Pending jobs right now: " # debug_show (jsonResponse));
            return #ok(jsonResponse);
        };
    };

    public shared func assignJobToClient(user_principal_id : Text, client_id : Int) : async Result.Result<Text, Text> {
        Debug.print("Received client with user_principal_id: " # user_principal_id);

        try {
            if (Text.size(user_principal_id) == 0) {
                let errorJson = "{" #
                    "\"status\": \"error\"," #
                    "\"message\": \"Invalid input: user_principal_id must not be empty\"" #
                    "}";
                return #err(errorJson);
            };

            let jobScanResult = CanDB.scan(
                jobDB,
                {
                    skLowerBound = "job";
                    skUpperBound = "job~";
                    limit = 10000;
                    ascending = null;
                    filter = ?{
                        attributeName = "state";
                        operator = #equal;
                        value = #text("pending");
                    };
                },
            );

            // Add explicit filtering after scan
            let pendingJobs = Array.filter(
                jobScanResult.entities,
                func(entity : { attributes : Entity.AttributeMap; pk : Text; sk : Text }) : Bool {
                    switch (Entity.getAttributeMapValueForKey(entity.attributes, "state")) {
                        case (?(#text(state))) {
                            Debug.print("Job state: " # state);
                            Text.equal(state, "pending");
                        };
                        case _ { false };
                    };
                },
            );
            switch (pendingJobs.size()) {
                case 0 {
                    Debug.print("No pending jobs found");
                    let errorJson = "{" #
                        "\"status\": \"error\"," #
                        "\"message\": \"No pending jobs available\"" #
                        "}";
                    return #err(errorJson);
                };
                case _ {
                    Debug.print("Job found");
                    let job = pendingJobs[0];
                    let jobID = job.sk;

                    // Update job state to ongoing
                    let updatedJobResult = await updateJobState(jobID, user_principal_id, "ongoing", Time.now(), 0);

                    switch (updatedJobResult) {
                        case (#ok()) {
                            // Update client state to working
                            let existingClient = CanDB.get(clientDB, { pk = "clientTable"; sk = user_principal_id });
                            let (currentWsConnect, currentWsDisconnect, totalUptime) = switch (existingClient) {
                                case (?entity) {
                                    (
                                        switch (Entity.getAttributeMapValueForKey(entity.attributes, "wsConnect")) {
                                            case (?(#int(v))) v;
                                            case _ 0;
                                        },
                                        switch (Entity.getAttributeMapValueForKey(entity.attributes, "wsDisconnect")) {
                                            case (?(#int(v))) v;
                                            case _ 0;
                                        },
                                        switch (Entity.getAttributeMapValueForKey(entity.attributes, "totalUptime")) {
                                            case (?(#int(v))) v;
                                            case _ 0;
                                        },
                                    );
                                };
                                case null (0, 0, 0);
                            };
                            let updatedClientResult = await updateClientState(user_principal_id, client_id, jobID, "working", currentWsConnect, currentWsDisconnect, Time.now(), 0, "Active", totalUptime);

                            switch (updatedClientResult) {
                                case (#ok()) {
                                    let jsonResponse = "{" #
                                    "\"status\": \"success\"," #
                                    "\"message\": \"Job assigned successfully\"," #
                                    "\"jobId\": \"" # jobID # "\"," #
                                    "\"user_principal_id\": \"" # user_principal_id # "\"" #
                                    "}";
                                    #ok(jsonResponse);
                                };
                                case (#err(errorMsg)) {
                                    // Revert job state if client update fails
                                    ignore updateJobState(jobID, user_principal_id, "pending", 0, 0);
                                    let errorJson = "{" #
                                        "\"status\": \"error\"," #
                                        "\"message\": \"Failed to update client state: " # errorMsg # "\"" #
                                        "}";
                                    return #err(errorJson);
                                };
                            };
                        };
                        case (#err(errorMsg)) {
                            let errorJson = "{" #
                                "\"status\": \"error\"," #
                                "\"message\": \"Failed to update job state: " # errorMsg # "\"" #
                                "}";
                            return #err(errorJson);
                        };
                    };
                };
            };
        } catch (error) {
            Debug.print("Error caught in job update: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Failed to update job: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    public shared func assignJob(user_principal_id : Text, client_id : Int, jobId: Text) : async Result.Result<Text, Text> {
        Debug.print("Received client with user_principal_id: " # user_principal_id);

        try {
            if (Text.size(user_principal_id) == 0) {
                let errorJson = "{" #
                    "\"status\": \"error\"," #
                    "\"message\": \"Invalid input: user_principal_id must not be empty\"" #
                    "}";
                return #err(errorJson);
            };

            // First, check if the user already exists
            let existingjob = CanDB.get(jobDB, { pk = "jobTable"; sk = jobId });

            switch (existingjob) {
                case (?_) {
                    // Job already exists, return an error
                    Debug.print("Job exists for jobId: " # jobId);
                    // Update job state to ongoing
                    let updatedJobResult = await updateJobState(jobId, user_principal_id, "ongoing", Time.now(), 0);

                    switch (updatedJobResult) {
                        case (#ok()) {
                            // Update client state to working
                            let existingClient = CanDB.get(clientDB, { pk = "clientTable"; sk = user_principal_id });
                            let (currentWsConnect, currentWsDisconnect, totalUptime) = switch (existingClient) {
                                case (?entity) {
                                    (
                                        switch (Entity.getAttributeMapValueForKey(entity.attributes, "wsConnect")) {
                                            case (?(#int(v))) v;
                                            case _ 0;
                                        },
                                        switch (Entity.getAttributeMapValueForKey(entity.attributes, "wsDisconnect")) {
                                            case (?(#int(v))) v;
                                            case _ 0;
                                        },
                                        switch (Entity.getAttributeMapValueForKey(entity.attributes, "totalUptime")) {
                                            case (?(#int(v))) v;
                                            case _ 0;
                                        },
                                    );
                                };
                                case null (0, 0, 0);
                            };
                            let updatedClientResult = await updateClientState(user_principal_id, client_id, jobId, "working", currentWsConnect, currentWsDisconnect, Time.now(), 0, "Active", totalUptime);

                            switch (updatedClientResult) {
                                case (#ok()) {
                                    let jsonResponse = "{" #
                                    "\"status\": \"success\"," #
                                    "\"message\": \"Job assigned successfully\"," #
                                    "\"jobId\": \"" # jobId # "\"," #
                                    "\"user_principal_id\": \"" # user_principal_id # "\"" #
                                    "}";
                                    #ok(jsonResponse);
                                };
                                case (#err(errorMsg)) {
                                    // Revert job state if client update fails
                                    ignore updateJobState(jobId, user_principal_id, "pending", 0, 0);
                                    let errorJson = "{" #
                                        "\"status\": \"error\"," #
                                        "\"message\": \"Failed to update client state: " # errorMsg # "\"" #
                                        "}";
                                    return #err(errorJson);
                                };
                            };
                        };
                        case (#err(errorMsg)) {
                            let errorJson = "{" #
                                "\"status\": \"error\"," #
                                "\"message\": \"Failed to update job state: " # errorMsg # "\"" #
                                "}";
                            return #err(errorJson);
                        };
                    };
                };
                case null {
                    // Job doesn't exist
                    Debug.print("New job");
                    let errorJson = "{" #
                        "\"status\": \"error\"," #
                        "\"message\": \"Job not found\"," #
                        "\"jobId\": \"" # jobId # "\"" #
                        "}";
                    return #err(errorJson);
                };
            };
        } catch (error) {
            Debug.print("Error caught in job update: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Failed to update job: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    private func updateClientStateWithRewards(
        user_principal_id : Text,
        jobID : Text,
        jobStatus : Text,
        jobStartTime : Int,
        jobEndTime : Int,
        todaysEarnings : Float,
        balance : Float,
    ) : async Result.Result<(), Text> {
        Debug.print("Attempting to update client with rewards info with user_principal_id: " # user_principal_id);

        try {
            let existingClient = CanDB.get(clientDB, { pk = "clientTable"; sk = user_principal_id });

            switch (existingClient) {
                case (?_clientEntity) {
                    Debug.print("Client found in DB with user_principal_id: " # user_principal_id);

                    let updatedAttributes = [
                        ("jobID", #text(jobID)),
                        ("jobStatus", #text(jobStatus)),
                        ("jobStartTime", #int(jobStartTime)),
                        ("jobEndTime", #int(jobEndTime)),
                        ("todaysEarnings", #float(todaysEarnings)),
                        ("balance", #float(balance)),
                    ];

                    func updateAttributes(attributeMap : ?Entity.AttributeMap) : Entity.AttributeMap {
                        switch (attributeMap) {
                            case null {
                                Entity.createAttributeMapFromKVPairs(updatedAttributes);
                            };
                            case (?map) {
                                Entity.updateAttributeMapWithKVPairs(map, updatedAttributes);
                            };
                        };
                    };

                    let _ = switch (
                        CanDB.update(
                            clientDB,
                            {
                                pk = "clientTable";
                                sk = user_principal_id;
                                updateAttributeMapFunction = updateAttributes;
                            },
                        )
                    ) {
                        case null {
                            Debug.print("Failed to update client with rewards: " # user_principal_id);
                            let errorJson = "{" #
                                "\"status\": \"error\"," #
                                "\"message\": \"Failed to update client\"" #
                                "}";
                            return #err(errorJson);
                        };
                        case (?_) {
                            #ok();
                        };
                    };
                };
                case null {
                    Debug.print("Client does not exist with user_principal_id: " # user_principal_id);
                    let errorJson = "{" #
                        "\"status\": \"error\"," #
                        "\"message\": \"Client does not exist\"" #
                        "}";
                    return #err(errorJson);
                };
            };
        } catch (error) {
            Debug.print("Error caught in client update: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Failed to update client: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    private func updateClientState(
        user_principal_id : Text,
        client_id : Int,
        jobID : Text,
        jobStatus : Text,
        wsConnect : Int,
        wsDisconnect : Int,
        jobStartTime : Int,
        jobEndTime : Int,
        clientStatus : Text,
        totalUptime : Int,
    ) : async Result.Result<(), Text> {
        Debug.print("Attempting to update client info with user_principal_id: " # user_principal_id);

        try {
            let existingClient = CanDB.get(clientDB, { pk = "clientTable"; sk = user_principal_id });

            switch (existingClient) {
                case (?_clientEntity) {
                    Debug.print("Client found in DB with user_principal_id: " # user_principal_id);

                    let updatedAttributes = [
                        ("client_id", #int(client_id)),
                        ("jobID", #text(jobID)),
                        ("jobStatus", #text(jobStatus)),
                        ("wsConnect", #int(wsConnect)),
                        ("wsDisconnect", #int(wsDisconnect)),
                        ("jobStartTime", #int(jobStartTime)),
                        ("jobEndTime", #int(jobEndTime)),
                        ("clientStatus", #text(clientStatus)),
                        ("totalUptime", #int(totalUptime)),
                    ];

                    func updateAttributes(attributeMap : ?Entity.AttributeMap) : Entity.AttributeMap {
                        switch (attributeMap) {
                            case null {
                                Entity.createAttributeMapFromKVPairs(updatedAttributes);
                            };
                            case (?map) {
                                Entity.updateAttributeMapWithKVPairs(map, updatedAttributes);
                            };
                        };
                    };

                    let _ = switch (
                        CanDB.update(
                            clientDB,
                            {
                                pk = "clientTable";
                                sk = user_principal_id;
                                updateAttributeMapFunction = updateAttributes;
                            },
                        )
                    ) {
                        case null {
                            Debug.print("Failed to update client: " # user_principal_id);
                            let errorJson = "{" #
                                "\"status\": \"error\"," #
                                "\"message\": \"Failed to update client\"" #
                                "}";
                            return #err(errorJson);
                        };
                        case (?_) {
                            #ok();
                        };
                    };
                };
                case null {
                    Debug.print("Client does not exist with user_principal_id: " # user_principal_id);
                    let errorJson = "{" #
                        "\"status\": \"error\"," #
                        "\"message\": \"Client does not exist\"" #
                        "}";
                    return #err(errorJson);
                };
            };
        } catch (error) {
            Debug.print("Error caught in client update: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Failed to update client: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    private func updateJobWithStoredFileId(
        jobID : Text,
        fileId : Int,
    ) : async Result.Result<(), Text> {
        Debug.print("Attempting to update job stored id info with jobID: " # jobID);

        try {
            let updatedAttributes = [
                ("storedID", #int(fileId)),
            ];

            func updateAttributes(attributeMap : ?Entity.AttributeMap) : Entity.AttributeMap {
                switch (attributeMap) {
                    case null {
                        Entity.createAttributeMapFromKVPairs(updatedAttributes);
                    };
                    case (?map) {
                        Entity.updateAttributeMapWithKVPairs(map, updatedAttributes);
                    };
                };
            };

            let _updated = switch (
                CanDB.update(
                    jobDB,
                    {
                        pk = "jobTable";
                        sk = jobID;
                        updateAttributeMapFunction = updateAttributes;
                    },
                )
            ) {
                case null {
                    Debug.print("Failed to update job: " # jobID);
                    #err("Failed to update job");
                };
                case (?_) {
                    #ok();
                };
            };
        } catch (error) {
            Debug.print("Error caught in job update: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Failed to update job: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    private func updateJobState(
        jobID : Text,
        user_principal_id : Text,
        newState : Text,
        assignedAt : Int,
        completeAt : Int,
    ) : async Result.Result<(), Text> {
        Debug.print("Attempting to update job info with jobID: " # jobID);

        try {
            let updatedAttributes = [
                ("state", #text(newState)),
                ("assignedAt", #int(assignedAt)),
                ("completeAt", #int(completeAt)),
                ("user_principal_id", #text(user_principal_id)),
            ];

            func updateAttributes(attributeMap : ?Entity.AttributeMap) : Entity.AttributeMap {
                switch (attributeMap) {
                    case null {
                        Entity.createAttributeMapFromKVPairs(updatedAttributes);
                    };
                    case (?map) {
                        Entity.updateAttributeMapWithKVPairs(map, updatedAttributes);
                    };
                };
            };

            let _updated = switch (
                CanDB.update(
                    jobDB,
                    {
                        pk = "jobTable";
                        sk = jobID;
                        updateAttributeMapFunction = updateAttributes;
                    },
                )
            ) {
                case null {
                    Debug.print("Failed to update job: " # jobID);
                    let errorJson = "{" #
                        "\"status\": \"error\"," #
                        "\"message\": \"Failed to update job\"" #
                        "}";
                    return #err(errorJson);
                };
                case (?_) {
                    #ok();
                };
            };
        } catch (error) {
            Debug.print("Error caught in client update: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Failed to update client: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    private func updateJobStateWithRewards(
        jobID : Text,
        reward : Float,
    ) : async Result.Result<(), Text> {
        Debug.print("Attempting to update job with rewards info with jobID: " # jobID);

        try {
            let updatedAttributes = [
                ("reward", #float(reward)),
            ];

            func updateAttributes(attributeMap : ?Entity.AttributeMap) : Entity.AttributeMap {
                switch (attributeMap) {
                    case null {
                        Entity.createAttributeMapFromKVPairs(updatedAttributes);
                    };
                    case (?map) {
                        Entity.updateAttributeMapWithKVPairs(map, updatedAttributes);
                    };
                };
            };

            let _updated = switch (
                CanDB.update(
                    jobDB,
                    {
                        pk = "jobTable";
                        sk = jobID;
                        updateAttributeMapFunction = updateAttributes;
                    },
                )
            ) {
                case null {
                    Debug.print("Failed to update job: " # jobID);
                    let errorJson = "{" #
                        "\"status\": \"error\"," #
                        "\"message\": \"Failed to update job\"" #
                        "}";
                    return #err(errorJson);
                };
                case (?_) {
                    #ok();
                };
            };
        } catch (error) {
            Debug.print("Error caught in client update: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Failed to update client: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    private func updateClientID(user_principal_id : Text, client_id : Int, clientStatus: Text) : async Result.Result<(), Text> {
        Debug.print("Attempting to update client_id for user_principal_id: " # user_principal_id);

        try {
            let existingClient = CanDB.get(clientDB, { pk = "clientTable"; sk = user_principal_id });

            switch (existingClient) {
                case (?_) {
                    Debug.print("Client found, updating client_id");

                    // Only update the client_id attribute
                    let updatedAttributes = [
                        ("client_id", #int(client_id)),
                        ("wsConnect", #int(Time.now())),
                        ("wsDisconnect", #int(0)),
                        ("jobStartTime", #int(0)),
                        ("jobEndTime", #int(0)),
                        ("jobID", #text("")),
                        ("jobStatus", #text("notWorking")),
                        ("clientStatus", #text(clientStatus)),
                    ];

                    func updateAttributes(attributeMap : ?Entity.AttributeMap) : Entity.AttributeMap {
                        switch (attributeMap) {
                            case null {
                                Entity.createAttributeMapFromKVPairs(updatedAttributes);
                            };
                            case (?map) {
                                Entity.updateAttributeMapWithKVPairs(map, updatedAttributes);
                            };
                        };
                    };

                    switch (
                        CanDB.update(
                            clientDB,
                            {
                                pk = "clientTable";
                                sk = user_principal_id;
                                updateAttributeMapFunction = updateAttributes;
                            },
                        )
                    ) {
                        case null {
                            Debug.print("Failed to update client_id for: " # user_principal_id);
                            let errorJson = "{" #
                            "\"status\": \"error\"," #
                                "\"message\": \"Failed to update client_id\"" #
                                "}";
                            return #err(errorJson);
                        };
                        case (?_) {
                            Debug.print("Successfully updated client_id");
                            #ok();
                        };
                    };
                };
                case null {
                    Debug.print("Client not found with user_principal_id: " # user_principal_id);
                    let errorJson = "{" #
                        "\"status\": \"error\"," #
                        "\"message\": \"Client not found\"" #
                        "}";
                    return #err(errorJson);
                };
            };
        } catch (error) {
            Debug.print("Error updating client_id: " # Error.message(error));
            #err("Failed to update client_id: " # Error.message(error));
        };
    };

    public func updateClientInternetSpeed(user_principal_id : Text, data : Text) : async Result.Result<Text, Text> {
        Debug.print("Attempting to update client internet data with user_principal_id: " # user_principal_id);

        try {
            let existingClient = CanDB.get(clientDB, { pk = "clientTable"; sk = user_principal_id });

            switch (existingClient) {
                case null {
                    Debug.print("Client does not exist with user_principal_id: " # user_principal_id);
                    let errorJson = "{" #
                        "\"status\": \"error\"," #
                        "\"message\": \"Client does not exist\"" #
                        "}";
                    return #err(errorJson);
                };
                case (?_clientEntity) {
                    Debug.print("Client found in DB with user_principal_id: " # user_principal_id);

                    let downloadSpeedText = removeQuotes(extractValue(data, "downloadSpeed\":"));
                    let pingText = removeQuotes(extractValue(data, "ping\":"));

                    var downloadSpeed : Float = textToFloat(downloadSpeedText);
                    var ping : Int = textToInt(pingText);

                    Debug.print("downloadSpeedText: " # debug_show (downloadSpeedText));
                    Debug.print("pingText: " # debug_show (pingText));

                    Debug.print("downloadSpeed: " # debug_show (downloadSpeed));
                    Debug.print("ping: " # Int.toText(ping));

                    Debug.print("data: " # debug_show (data));

                    // If you need a Nat
                    let pingNat : Nat = Int.abs(ping);
                    Debug.print("ping as Nat: " # Nat.toText(pingNat));

                    // Parse the JSON string
                    let parsedData = JSON.parse(data);
                    Debug.print("Parsed Data: " # debug_show (parsedData));

                    let now = Time.now();
                    let wsConnect = switch (Entity.getAttributeMapValueForKey(_clientEntity.attributes, "wsConnect")) {
                        case (?(#int(t))) t;
                        case _ 0;
                    };
                    
                    let totalUptime = switch (Entity.getAttributeMapValueForKey(_clientEntity.attributes, "totalUptime")) {
                        case (?(#int(u))) u;
                        case _ 0;
                    };
                    
                    let dailyUptime = switch (Entity.getAttributeMapValueForKey(_clientEntity.attributes, "dailyUptime")) {
                        case (?(#int(u))) u;
                        case _ 0;
                    };

                    // Calculate uptime since last ping (or since connection if first ping)
                    let lastPingTimestamp = switch (Entity.getAttributeMapValueForKey(_clientEntity.attributes, "pingTimestamp")) {
                        case (?(#int(t))) t;
                        case _ wsConnect; // Use connection time if no previous ping
                    };
                    
                    let uptimeIncrement = if (lastPingTimestamp > 0) now - lastPingTimestamp else 0;
                    let newTotalUptime = totalUptime + uptimeIncrement;
                    
                    // Check if this is a new day
                    let currentDayStart = getStartOfDay(now / 1_000_000_000);
                    let lastPingDayStart = getStartOfDay(lastPingTimestamp / 1_000_000_000);
                    let newDailyUptime = if (currentDayStart > lastPingDayStart) {
                        // New day, reset daily uptime and add current session
                        uptimeIncrement
                    } else {
                        // Same day, accumulate
                        dailyUptime + uptimeIncrement
                    };

                    Debug.print("Uptime calculation - lastPing: " # Int.toText(lastPingTimestamp) # ", increment: " # Int.toText(uptimeIncrement) # ", newTotal: " # Int.toText(newTotalUptime) # ", newDaily: " # Int.toText(newDailyUptime));

                    let updatedAttributes : [(Text, Entity.AttributeValue)] = [
                        ("downloadSpeed", #float(downloadSpeed)),
                        ("ping", #int(Int.abs(ping))),
                        ("clientStatus", #text("Active")),
                        ("pingTimestamp", #int(now)),
                        ("totalUptime", #int(newTotalUptime)),
                        ("dailyUptime", #int(newDailyUptime))
                    ];

                    func updateAttributes(attributeMap : ?Entity.AttributeMap) : Entity.AttributeMap {
                        switch (attributeMap) {
                            case null {
                                Entity.createAttributeMapFromKVPairs(updatedAttributes);
                            };
                            case (?map) {
                                Entity.updateAttributeMapWithKVPairs(map, updatedAttributes);
                            };
                        };
                    };

                    let _updateResult = switch (
                        CanDB.update(
                            clientDB,
                            {
                                pk = "clientTable";
                                sk = user_principal_id;
                                updateAttributeMapFunction = updateAttributes;
                            },
                        )
                    ) {
                        case null {
                            Debug.print("Failed to update client internet speed: " # user_principal_id);
                            let errorJson = "{" #
                                "\"status\": \"error\"," #
                                "\"message\": \"Failed to update client\"" #
                                "}";
                            return #err(errorJson);
                        };
                        case (?_) {
                            Debug.print("Successfully updated internet speed for user_principal_id: " # user_principal_id);
                            let jsonResponse = "{" #
                            "\"function\": \"Notification\"," #
                            "\"message\": \"Client internet speed updated successfully\"," #
                            "\"user_principal_id\": \"" # user_principal_id # "\"," #
                            "\"state\": \"updated\"," #
                            "\"status\": \"OK\"" #
                            "}";
                            #ok(jsonResponse);
                        };
                    };

                    let jsonResponse = "{" #
                    "\"function\": \"Notification\"," #
                    "\"message\": \"Client internet speed updated successfully\"," #
                    "\"user_principal_id\": \"" # user_principal_id # "\"," #
                    "\"state\": \"updated\"," #
                    "\"status\": \"OK\"" #
                    "}";
                    #ok(jsonResponse);
                };
            };
        } catch (error) {
            Debug.print("Error caught while updating client internet speed: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"Failed to update client internet speed: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    func textToNumber(t : Text) : (Int, Int, Int) {
        var intPart = 0;
        var fracPart = 0;
        var fracDigits = 0;
        var isNegative = false;
        var seenDot = false;

        for (c in t.chars()) {
            switch (c) {
                case '-' { isNegative := true };
                case '.' { seenDot := true };
                case d {
                    let digit = Char.toNat32(d) - 48; // ASCII '0' is 48
                    if (seenDot) {
                        fracPart := fracPart * 10 + Nat32.toNat(digit);
                        fracDigits += 1;
                    } else {
                        intPart := intPart * 10 + Nat32.toNat(digit);
                    };
                };
            };
        };

        let sign = if (isNegative) -1 else 1;
        (sign * intPart, fracPart, fracDigits);
    };

    func textToFloat(t : Text) : Float {
        let (intPart, fracPart, fracDigits) = textToNumber(t);
        let fracValue = Float.fromInt(fracPart) / Float.pow(10, Float.fromInt(fracDigits));
        Float.fromInt(intPart) + (if (intPart < 0) -fracValue else fracValue);
    };

    func textToInt(t : Text) : Int {
        let (intPart, _, _) = textToNumber(t);
        intPart;
    };

    func extractValue(text : Text, key : Text) : Text {
        let iter = Text.split(text, #text key);
        switch (iter.next()) {
            case null { "" };
            case (?_) {
                switch (iter.next()) {
                    case null { "" };
                    case (?value) {
                        let valueIter = Text.split(value, #text ",");
                        switch (valueIter.next()) {
                            case null { "" };
                            case (?v) {
                                // Remove quotation marks, closing brace, and trim whitespace
                                Text.trim(Text.replace(v, #text "\"", ""), #char '}');
                            };
                        };
                    };
                };
            };
        };
    };

    func removeQuotes(text : Text) : Text {
        Text.replace(text, #text "\"", "");
    };

    private func unwrapJobEntity(entity : Entity.Entity) : ?JobStruct {
        DatabaseOps.unwrapJobEntity(entity);
    };

    private func unwrapClientEntity(entity : Entity.Entity) : ?ClientStruct {
        DatabaseOps.unwrapClientEntity(entity);
    };

    public func login(user_principal_id : Text) : async Result.Result<ClientStruct, Text> {

        try {
            // Validate the user_principal_id as a Principal
            let _ = Principal.fromText(user_principal_id);

            // Check if the client exists in the database
            let existingClient = CanDB.get(clientDB, { pk = "clientTable"; sk = user_principal_id });

            switch (existingClient) {
                case null {
                    // If client is not found, add the client to the DB
                    Debug.print("Client not found for user_principal_id: " # user_principal_id);
                    let randomGenerator = Random.new();
                    let referralCode_ = await randomGenerator.next();
                    let referralCode = "#ref" # referralCode_;
                    let registerClient = await addClientToDB(user_principal_id, referralCode);
                    switch (registerClient) {
                        case (#ok(_)) {
                            let getClient = CanDB.get(clientDB, { pk = "clientTable"; sk = user_principal_id });
                            switch (getClient) {
                                case (?entity) {
                                    //Client found
                                    Debug.print("Client found for user_principal_id: " # user_principal_id);
                                    switch (unwrapClientEntity(entity)) {
                                        case (?clientStruct) {
                                            #ok(clientStruct);
                                        };
                                        case null {
                                           let errorJson = "{" #
                                                "\"status\": \"error\"," #
                                                "\"message\": \"Error unwrapping client data\"" #
                                                "}";
                                            return #err(errorJson);
                                        };
                                    };
                                };
                                case null {
                                    let errorJson = "{" #
                                        "\"status\": \"error\"," #
                                        "\"message\": \"Error getting client data\"" #
                                        "}";
                                    return #err(errorJson);
                                };
                            };
                        };
                        case (#err(errorMessage)) {
                            Debug.print("Failed to create client: " # errorMessage);
                            let errorJson = "{" #
                                "\"status\": \"error\"," #
                                "\"message\": \"Failed to create client: " # errorMessage # "\"," #
                                "\"user_principal_id\": \"" # user_principal_id # "\"," #
                                "\"state\": \"error\"" #
                                "}";
                            return #err(errorJson);
                        };
                    };
                };
                case (?entity) {
                    //Client found
                    Debug.print("Client found for user_principal_id: " # user_principal_id);
                    
                    // Check if we need to reset todaysEarnings for a new day
                    let currentTime = getCurrentTime();
                    let currentDayStart = getStartOfDay(currentTime);
                    
                    let lastJobEndTime = switch (Entity.getAttributeMapValueForKey(entity.attributes, "jobEndTime")) {
                        case (?(#int(v))) v / 1_000_000_000; // Convert nanoseconds to seconds
                        case _ 0;
                    };
                    
                    let lastPingTimestamp = switch (Entity.getAttributeMapValueForKey(entity.attributes, "pingTimestamp")) {
                        case (?(#int(v))) v / 1_000_000_000; // Convert nanoseconds to seconds  
                        case _ 0;
                    };
                    
                    // Use the most recent activity timestamp
                    let lastActivityTime = if (lastJobEndTime > lastPingTimestamp) lastJobEndTime else lastPingTimestamp;
                    let lastActivityDayStart = getStartOfDay(lastActivityTime);
                    
                    Debug.print("Login day check - current day: " # Int.toText(currentDayStart) # ", last activity day: " # Int.toText(lastActivityDayStart));
                    
                    let updatedEntity = if (currentDayStart > lastActivityDayStart and lastActivityTime > 0) {
                        // It's a new day, reset todaysEarnings
                        Debug.print("New day detected, resetting todaysEarnings to 0.0");
                        
                        func updateAttributes(attributeMap : ?Entity.AttributeMap) : Entity.AttributeMap {
                            switch (attributeMap) {
                                case null { Entity.createAttributeMapFromKVPairs([("todaysEarnings", #float(0.0))]) };
                                case (?map) { Entity.updateAttributeMapWithKVPairs(map, [("todaysEarnings", #float(0.0))]) };
                            };
                        };
                        
                        switch (CanDB.update(clientDB, { pk = "clientTable"; sk = user_principal_id; updateAttributeMapFunction = updateAttributes })) {
                            case (?updatedEntity) { updatedEntity };
                            case null { entity }; // Fallback to original entity if update fails
                        };
                    } else {
                        entity; // No need to update
                    };
                    
                    switch (unwrapClientEntity(updatedEntity)) {
                        case (?clientStruct) {
                            #ok(clientStruct);
                        };
                        case null {
                            let errorJson = "{" #
                                "\"status\": \"error\"," #
                                "\"message\": \"Error unwrapping client data\"" #
                                "}";
                            return #err(errorJson);
                        };
                    };
                };
            };
        } catch (error) {
            Debug.print("An unexpected error occurred: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"An unexpected error occurred: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    public func getUserRewardHistory(user_principal_id : Text) : async Result.Result<[JobStruct], Text> {
        try {
            // Validate the user_principal_id as a Principal
            //let _ = Principal.fromText(user_principal_id);

            let skLowerBound = ""; // Start of the range for all keys
            let skUpperBound = "~"; // End of the range for all keys
            let limit = 10000; // Limit number of records to scan
            let ascending = null; // Not specifying order

            // Use CanDB.scan to retrieve all records
            let { entities } = CanDB.scan(
                jobDB,
                {
                    skLowerBound = skLowerBound;
                    skUpperBound = skUpperBound;
                    limit = limit;
                    ascending = ascending;
                },
            );

            Debug.print("Total entities: " # debug_show (entities.size()));

            let userRewards = Array.mapFilter<Entity.Entity, JobStruct>(
                entities,
                func(entity : Entity.Entity) : ?JobStruct {
                    switch (unwrapJobEntity(entity)) {
                        case (?job) {
                            if (Text.equal(job.user_principal_id, user_principal_id) and job.reward > 0.0) {
                                ?job;
                            } else {
                                null;
                            };
                        };
                        case (null) null;
                    };
                },
            );

            if (Array.size(userRewards) > 0) {
                #ok(userRewards);
            } else {
                let errorJson = "{" #
                    "\"status\": \"error\"," #
                    "\"message\": \"No reward history found for the user\"" #
                    "}";
                return #err(errorJson);
            };
        } catch (error) {
            Debug.print("An unexpected error occurred: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"An unexpected error occurred: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    public func clientConnect(user_principal_id : Text, client_id : Int) : async Result.Result<Text, Text> {

        try {
            // Validate the user_principal_id as a Principal
            let _ = Principal.fromText(user_principal_id);

            // Check if the client exists in the database
            let existingClient = CanDB.get(clientDB, { pk = "clientTable"; sk = user_principal_id });

            switch (existingClient) {
                case null {
                    // If client is not found, return with error
                    let jsonResponse = "{" #
                    "\"function\": \"Notification\"," #
                    "\"message\": \"New client, Please signin first\"," #
                    "\"user_principal_id\": \"" # user_principal_id # "\"," #
                    "\"state\": \"new\"," #
                    "\"status\": \"ERROR\"," #
                    "}";
                    #ok(jsonResponse);
                };
                case (?_) {
                    //Client found, continue without changes
                    Debug.print("Client found for user_principal_id: " # user_principal_id);
                    //update client_id
                    let updateClient = await updateClientID(user_principal_id, client_id, "Active");
                    switch (updateClient) {
                        case (#ok()) {
                            let jsonResponse = "{" #
                            "\"function\": \"Notification\"," #
                            "\"message\": \"Client ID updated in DB\"," #
                            "\"user_principal_id\": \"" # user_principal_id # "\"," #
                            "\"state\": \"waiting\"," #
                            "\"status\": \"OK\"," #
                            "\"jobAssigned\": false" #
                            "}";
                            #ok(jsonResponse);
                        };
                        case (#err(errorMessage)) {
                            Debug.print("Failed to update clientID: " # errorMessage);
                            let errorJson = "{" #
                                "\"status\": \"error\"," #
                                "\"message\": \"Failed to update clientID: " # errorMessage # "\"," #
                                "\"user_principal_id\": \"" # user_principal_id # "\"," #
                                "\"state\": \"error\"" #
                                "}";
                            return #err(errorJson);
                        };
                    };
                };
            };
        } catch (error) {
            Debug.print("An unexpected error occurred: " # Error.message(error));
            let errorJson = "{" #
                "\"status\": \"error\"," #
                "\"message\": \"An unexpected error occurred: " # Error.message(error) # "\"" #
                "}";
            return #err(errorJson);
        };
    };

    public func clientDisconnect(client_id : Int) : async Text {
        Debug.print("Client disconnecting with ID: " # Int.toText(client_id));

        try {
            // Scan clientDB to find entry with matching client_id
            let filter = ?{
                attributeName = "client_id";
                operator = #equal;
                value = #int(client_id);
            };

            let { entities } = CanDB.scan(
                clientDB,
                {
                    skLowerBound = "";
                    skUpperBound = "~";
                    limit = 1;
                    ascending = null;
                    filter = filter;
                },
            );

            switch (entities.size()) {
                case 0 {
                    return createJsonResponse("error", "Client not found", "", "unknown");
                };
                case _ {
                    let entity = entities[0];
                    let user_principal_id = entity.sk;

                    // Get current job status
                    let jobID = switch (Entity.getAttributeMapValueForKey(entity.attributes, "jobID")) {
                        case (?(#text(j))) j;
                        case _ "";
                    };
                    let jobStatus = switch (Entity.getAttributeMapValueForKey(entity.attributes, "jobStatus")) {
                        case (?(#text(j))) j;
                        case _ "";
                    };
                    let wsConnect = switch (Entity.getAttributeMapValueForKey(entity.attributes, "wsConnect")) {
                        case (?(#int(t))) t;
                        case _ 0;
                    };

                    let totalUptime = switch (Entity.getAttributeMapValueForKey(entity.attributes, "totalUptime")) {
                        case (?(#int(t))) t;
                        case _ 0;
                    };

                    let now = Time.now();
                    let sessionUptime = now - wsConnect;
                    let newTotalUptime = totalUptime + sessionUptime;

                    // If client was working on a job, reset it
                    if (jobID != "" and jobStatus == "working") {
                        let jobUpdateResult = await updateJobState(
                            jobID,
                            "",
                            "pending",
                            0,
                            0,
                        );

                        let clientUpdateResult = await updateClientState(
                            user_principal_id,
                            client_id,
                            "",
                            "notWorking",
                            wsConnect,
                            Time.now(),
                            0,
                            0,
                            "Inactive",
                            newTotalUptime
                        );

                        switch (jobUpdateResult, clientUpdateResult) {
                            case (#ok(), #ok()) {
                                Debug.print("Client disconnected and job reset");
                                return createJsonResponse("success", "Client disconnected and job reset", user_principal_id, jobID);
                            };
                            case _ {
                                Debug.print("Failed to update states");
                                return createJsonResponse("error", "Failed to update states", user_principal_id, "error");
                            };
                        };
                    } else {
                        // Just update disconnect time
                        let clientUpdateResult = await updateClientState(
                            user_principal_id,
                            client_id,
                            "",
                            "notWorking",
                            wsConnect,
                            Time.now(),
                            0,
                            0,
                            "Inactive",
                            newTotalUptime
                        );

                        switch (clientUpdateResult) {
                            case (#ok()) {
                                return createJsonResponse("success", "Client disconnected", user_principal_id, "");
                            };
                            case (#err(error)) {
                                Debug.print("Failed to update client: " # error);
                                return createJsonResponse("error", "Failed to update client", user_principal_id, "error");
                            };
                        };
                    };
                };
            };
        } catch (error) {
            Debug.print("Error in clientDisconnect: " # Error.message(error));
            return createJsonResponse("error", "An unexpected error occurred", "", "unknown");
        };
    };

    public func findAndAssignJob(jobId: Text) : async ?{
        user_principal_id : Text;
        client_id : Int;
        downloadSpeed : Float;
        target : Text;
        jobType : Text;
    } {
        // Check if the job exists
        let existingJob = CanDB.get(jobDB, { pk = "jobTable"; sk = jobId });
        switch (existingJob) {
            case null {
                Debug.print("Job not found for jobId: " # jobId);
                null;
            };
            case (?entity) {
                // Unwrap the entity to JobStruct
                switch (unwrapJobEntity(entity)) {
                    case (?jobStruct) {
                        // Find optimal node
                        let optimalNode = await getOptimalNode();
                        switch (optimalNode) {
                            case (null) {
                                Debug.print("No optimal node found");
                                null;
                            };
                            case (?node) {
                                let assignResult = await assignJob(node.user_principal_id, node.client_id, jobId);
                                switch (assignResult) {
                                    case (#ok(message)) {
                                        Debug.print("Optimal node found and job assigned. " # message);
                                        ?{
                                            user_principal_id = node.user_principal_id;
                                            client_id = node.client_id;
                                            downloadSpeed = node.downloadSpeed;
                                            target = jobStruct.target;
                                            jobType = jobStruct.jobType;
                                        };
                                    };
                                    case (#err(error)) {
                                        Debug.print("Optimal node found but job assignment failed. " # error);
                                        ?{
                                            user_principal_id = node.user_principal_id;
                                            client_id = node.client_id;
                                            downloadSpeed = node.downloadSpeed;
                                            target = jobStruct.target;
                                            jobType = jobStruct.jobType;
                                        };
                                    };
                                };
                            };
                        };
                    };
                    case null {
                        Debug.print("Error unwrapping job entity for jobId: " # jobId);
                        null;
                    };
                };
            };
        };
    };

    public func findAndAssignJobToClient(jobId: Text, principalId: Text) : async ?{
        user_principal_id : Text;
        client_id : Int;
        downloadSpeed : Float;
        target : Text;
        jobType : Text;
    } {
        // Check if the job exists
        let existingJob = CanDB.get(jobDB, { pk = "jobTable"; sk = jobId });
        switch (existingJob) {
            case null {
                Debug.print("Job not found for jobId: " # jobId);
                null;
            };
            case (?entity) {
                // Unwrap the entity to JobStruct
                switch (unwrapJobEntity(entity)) {
                    case (?jobStruct) {
                        // Find optimal node
                        let optimalNode = await getOptimalClient(principalId);
                        switch (optimalNode) {
                            case (null) {
                                Debug.print("No optimal node found");
                                null;
                            };
                            case (?node) {
                                let assignResult = await assignJob(node.user_principal_id, node.client_id, jobId);
                                switch (assignResult) {
                                    case (#ok(message)) {
                                        Debug.print("Optimal node found and job assigned. " # message);
                                        ?{
                                            user_principal_id = node.user_principal_id;
                                            client_id = node.client_id;
                                            downloadSpeed = node.downloadSpeed;
                                            target = jobStruct.target;
                                            jobType = jobStruct.jobType;
                                        };
                                    };
                                    case (#err(error)) {
                                        Debug.print("Optimal node found but job assignment failed. " # error);
                                        ?{
                                            user_principal_id = node.user_principal_id;
                                            client_id = node.client_id;
                                            downloadSpeed = node.downloadSpeed;
                                            target = jobStruct.target;
                                            jobType = jobStruct.jobType;
                                        };
                                    };
                                };
                            };
                        };
                    };
                    case null {
                        Debug.print("Error unwrapping job entity for jobId: " # jobId);
                        null;
                    };
                };
            };
        };
    };

    public func resendJob(jobId: Text) : async ?{
        user_principal_id : Text;
        client_id : Int;
        downloadSpeed : Float;
        target : Text;
        jobType : Text;
    } {
        // Scan clientDB to find if any client has this jobID assigned
        let filter = ?{
            attributeName = "jobID";
            operator = #equal;
            value = #text(jobId);
        };

        let { entities } = CanDB.scan(
            clientDB,
            {
                skLowerBound = "";
                skUpperBound = "~";
                limit = 1;
                ascending = null;
                filter = filter;
            },
        );

        if (entities.size() > 0) {
            let entity = entities[0];
            let user_principal_id = entity.sk;
            let client_id = switch (Entity.getAttributeMapValueForKey(entity.attributes, "client_id")) {
                case (?(#int(cid))) cid;
                case _ 0;
            };
            let wsConnect = switch (Entity.getAttributeMapValueForKey(entity.attributes, "wsConnect")) {
                case (?(#int(t))) t;
                case _ 0;
            };
            let pingTimestamp = switch (Entity.getAttributeMapValueForKey(entity.attributes, "pingTimestamp")) {
                case (?(#int(t))) t;
                case _ 0;
            };
            let totalUptime = switch (Entity.getAttributeMapValueForKey(entity.attributes, "totalUptime")) {
                case (?(#int(t))) t;
                case _ 0;
            };

            let diff = pingTimestamp - wsConnect;
            let newTotalUptime = totalUptime + diff;

            // Clear jobID and set status to notWorking for the client
            let clientUpdateResult = await updateClientState(
                user_principal_id,
                client_id,
                "",
                "notWorking",
                wsConnect,
                Time.now(),
                0,
                0,
                "Inactive",
                newTotalUptime
            );
            switch (clientUpdateResult) {
                case (#ok()) {
                    Debug.print("Cleared jobID and set status to notWorking for client: " # user_principal_id);
                };
                case (#err(error)) {
                    Debug.print("Failed to update client state: " # error);
                    return null;
                };
            };

            // Also update the job state to "pending"
            let jobUpdateResult = await updateJobState(
                jobId,
                "",
                "pending",
                0,
                0,
            );
            switch (jobUpdateResult) {
                case (#ok()) {
                    Debug.print("Job state updated to pending for jobId: " # jobId);
                };
                case (#err(error)) {
                    Debug.print("Failed to update job state: " # error);
                    return null;
                };
            };
        };

        // Check if the job exists
        let existingJob = CanDB.get(jobDB, { pk = "jobTable"; sk = jobId });
        switch (existingJob) {
            case null {
                Debug.print("Job not found for jobId: " # jobId);
                null;
            };
            case (?entity) {
                switch (unwrapJobEntity(entity)) {
                    case (?jobStruct) {
                        // Find optimal node and assign job
                        let optimalNode = await getOptimalNode();
                        switch (optimalNode) {
                            case (null) {
                                Debug.print("No optimal node found");
                                null;
                            };
                            case (?node) {
                                let assignResult = await assignJob(node.user_principal_id, node.client_id, jobId);
                                switch (assignResult) {
                                    case (#ok(_)) {};
                                    case (#err(error)) {
                                        Debug.print("Job assignment failed: " # error);
                                    };
                                };
                                ?{
                                    user_principal_id = node.user_principal_id;
                                    client_id = node.client_id;
                                    downloadSpeed = node.downloadSpeed;
                                    target = jobStruct.target;
                                    jobType = jobStruct.jobType;
                                };
                            };
                        };
                    };
                    case null {
                        Debug.print("Error unwrapping job entity for jobId: " # jobId);
                        null;
                    };
                };
            };
        };
    };

    private func getOptimalClient(principalId: Text) : async ?{
        user_principal_id : Text;
        client_id : Int;
        downloadSpeed : Float;
    } {
        let skLowerBound = ""; // Start of the range for client keys
        let skUpperBound = "~"; // End of the range for client keys
        let limit = 10000; // Limit number of records to scan
        let ascending = null; // Not specifying order

        // Use CanDB.scan to retrieve job records
        let { entities } = CanDB.scan(
            clientDB,
            {
                skLowerBound = skLowerBound;
                skUpperBound = skUpperBound;
                limit = limit;
                ascending = ascending;
            },
        );

        Debug.print("Total entities: " # debug_show (entities.size()));

        // First, try to find an entity with the given principalId
        for (entity in entities.vals()) {
            let currentUserId = switch (Entity.getAttributeMapValueForKey(entity.attributes, "user_principal_id")) {
                case (?(#text(id))) id;
                case _ "";
            };
            if (currentUserId == principalId) {
                let currentSpeed = switch (Entity.getAttributeMapValueForKey(entity.attributes, "downloadSpeed")) {
                    case (?(#float(speed))) speed;
                    case _ 0.0;
                };
                let currentClientId = switch (Entity.getAttributeMapValueForKey(entity.attributes, "client_id")) {
                    case (?(#int(id))) id;
                    case _ 0;
                };
                return ?{
                    client_id = currentClientId;
                    downloadSpeed = currentSpeed;
                    user_principal_id = currentUserId;
                };
            };
        };
        // If not found, return null
        return null;
    };

    private func getOptimalNode() : async ?{
        user_principal_id : Text;
        client_id : Int;
        downloadSpeed : Float;
    } {
        let skLowerBound = ""; // Start of the range for client keys
        let skUpperBound = "~"; // End of the range for client keys
        let limit = 10000; // Limit number of records to scan
        let ascending = null; // Not specifying order

        // Use CanDB.scan to retrieve job records
        let { entities } = CanDB.scan(
            clientDB,
            {
                skLowerBound = skLowerBound;
                skUpperBound = skUpperBound;
                limit = limit;
                ascending = ascending;
            },
        );

        Debug.print("Total entities: " # debug_show (entities.size()));

        let entityWithMaxSpeed = Array.foldLeft(
            entities,
            null : ?{
                client_id : Int;
                downloadSpeed : Float;
                user_principal_id : Text;
            },
            func(maxEntity : ?{ client_id : Int; downloadSpeed : Float; user_principal_id : Text }, currentEntity : { attributes : Entity.AttributeMap; pk : Text; sk : Text }) : ?{
                client_id : Int;
                downloadSpeed : Float;
                user_principal_id : Text;
            } {
                let currentSpeed = switch (Entity.getAttributeMapValueForKey(currentEntity.attributes, "downloadSpeed")) {
                    case (?(#float(speed))) speed;
                    case _ 0.0;
                };
                let currentClientId = switch (Entity.getAttributeMapValueForKey(currentEntity.attributes, "client_id")) {
                    case (?(#int(id))) id;
                    case _ 0;
                };
                let currentUserId = switch (Entity.getAttributeMapValueForKey(currentEntity.attributes, "user_principal_id")) {
                    case (?(#text(id))) id;
                    case _ "";
                };

                let wsDisconnect = switch (Entity.getAttributeMapValueForKey(currentEntity.attributes, "wsDisconnect")) {
                    case (?(#int(value))) value;
                    case _ 1; // Default to non-zero if not found or not an int
                };

                let jobStatus = switch (Entity.getAttributeMapValueForKey(currentEntity.attributes, "jobStatus")) {
                    case (?(#text(status))) status;
                    case _ "";
                };

                // Only consider this entity if wsDisconnect is 0
                if (wsDisconnect == 0 and jobStatus == "notWorking") {
                    switch (maxEntity) {
                        case (null) ?{
                            client_id = currentClientId;
                            downloadSpeed = currentSpeed;
                            user_principal_id = currentUserId;
                        };
                        case (?maxEnt) {
                            if (currentSpeed > maxEnt.downloadSpeed) ?{
                                client_id = currentClientId;
                                downloadSpeed = currentSpeed;
                                user_principal_id = currentUserId;
                            } else ?maxEnt;
                        };
                    };
                } else {
                    maxEntity; // Keep the current max if this entity's wsDisconnect is not 0
                };
            },
        );

        return entityWithMaxSpeed;
    };

    // Function to get the current time in UTC
    func getCurrentTime() : Int {
        Time.now() / 1_000_000_000;
    };

    // Function to get the start of the day for a given timestamp
    func getStartOfDay(timestamp : Int) : Int {
        timestamp - (timestamp % 86400);
    };

    func getEndOfDay(timestamp : Int) : Int {
        getStartOfDay(timestamp) + 86399 // Last second of the day
    };

    // =============== Maintenance Tasks ===============
    private func _hourlyJobCheck() : async () {
        Debug.print("Performing hourly job check...");
        let currentTime = Time.now();

        let jobScanResult = CanDB.scan(
            jobDB,
            {
                skLowerBound = "job";
                skUpperBound = "job~";
                limit = 1000;
                ascending = null;
                filter = ?{
                    attributeName = "state";
                    operator = #equal;
                    value = #text("ongoing");
                };
            },
        );

        for (jobEntity in jobScanResult.entities.vals()) {
            switch (unwrapJobEntity(jobEntity)) {
                case null {
                    Debug.print("Failed to unwrap job entity");
                    // Skip this iteration
                };
                case (?job) {
                    if (job.state == "ongoing") {
                        await checkAndUpdateStaleJob(job, currentTime);
                    };
                };
            };
        };

        Debug.print("Hourly job check completed.");
    };

    private func checkAndUpdateStaleJob(job : JobStruct, currentTime : Int) : async () {
        let clientResult = CanDB.get(clientDB, { pk = "clientTable"; sk = job.user_principal_id });

        switch (clientResult) {
            case (?clientEntity) {
                switch (unwrapClientEntity(clientEntity)) {
                    case (?client) {
                        if (client.wsDisconnect > 0 and currentTime - client.wsDisconnect > DEAD_TIMEOUT) {
                            // Reset job to pending state
                            ignore await DB.updateEntity(
                                jobDB,
                                "jobTable",
                                job.jobID,
                                [
                                    ("state", #text("pending")),
                                    ("user_principal_id", #text("")),
                                    ("assignedAt", #int(0)),
                                ],
                            );
                        };
                    };
                    case null {
                        Debug.print("Failed to unwrap client entity");
                    };
                };
            };
            case null {
                // Client not found, reset job
                ignore await DB.updateEntity(
                    jobDB,
                    "jobTable",
                    job.jobID,
                    [
                        ("state", #text("pending")),
                        ("user_principal_id", #text("")),
                        ("assignedAt", #int(0)),
                    ],
                );
            };
        };
    };

    // Optional: Uncomment to enable hourly job checking
    // ignore Timer.recurringTimer<system>(#seconds(3600), hourlyJobCheck);

    private func createJsonResponse(status : Text, message : Text, user_principal_id : Text, state : Text) : Text {
        HttpHandler.createJsonResponse(status, message, user_principal_id, state);
    };

    private module DB {
        public func updateEntity(db : CanDB.DB, pk : Text, sk : Text, updates : [(Text, Entity.AttributeValue)]) : async Result.Result<(), Text> {
            try {
                func updateAttributes(attributeMap : ?Entity.AttributeMap) : Entity.AttributeMap {
                    switch (attributeMap) {
                        case null Entity.createAttributeMapFromKVPairs(updates);
                        case (?map) Entity.updateAttributeMapWithKVPairs(map, updates);
                    };
                };

                switch (CanDB.update(db, { pk; sk; updateAttributeMapFunction = updateAttributes })) {
                    case null #err("Failed to update entity");
                    case (?_) #ok();
                };
            } catch (error) {
                Debug.print("Error in entity update: " # Error.message(error));
                #err("Update failed: " # Error.message(error));
            };
        };
    };

    //admin functionality
    // Generate a unique API key without hyphens
    func generateAPIKey(adminUUID : Text) : Text {
        // We need to provide a seed for the UUID generation
        let seed = Text.encodeUtf8(adminUUID);
        let uuid = UUID.generateV4(seed);
        // Remove hyphens from the UUID
        return Text.replace(uuid, #text "-", "");
    };

    private func createEntity(adminUUID : Text, data : APIKeyData) : {
        pk : Text;
        sk : Text;
        attributes : [(Text, Entity.AttributeValue)];
    } {
        Debug.print("Attempting to create admin entity: ");
        {
            pk = "adminTable";
            sk = adminUUID;
            attributes = [
                ("apiKey", #text(data.apiKey)),
                ("usageCount", #int(0)),
                ("usageLimit", #int(USAGE_LIMIT)),
                ("usageLog", #arrayInt(Array.map<UsageEntry, Int>(
                    data.usageLog, 
                    func(entry : UsageEntry) : Int {
                        entry.timestamp
                    }
                )))
            ];
        };
    };

    // Function to convert entity to APIKeyData
    func entityToAPIKeyData(entity : Entity.Entity) : ?APIKeyData {
        let attributes = entity.attributes;
        do ? {
            {
                apiKey = switch (Entity.getAttributeMapValueForKey(attributes, "apiKey")) {
                    case (?(#text(v))) v;
                    case _ return null;
                };
                usageCount = switch (Entity.getAttributeMapValueForKey(attributes, "usageCount")) {
                    case (?(#int(v))) Int.abs(v);
                    case _ return null;
                };
                usageLimit = switch (Entity.getAttributeMapValueForKey(attributes, "usageLimit")) {
                    case (?(#int(v))) Int.abs(v);
                    case _ return null;
                };
                usageLog = switch (Entity.getAttributeMapValueForKey(attributes, "usageLog")) {
                    case (?(#arrayInt(timestamps))) {
                        Array.map<Int, UsageEntry>(
                            timestamps,
                            func(timestamp : Int) : UsageEntry {
                                { timestamp = timestamp }
                            }
                        )
                    };
                    case _ [];
                };
            };
        };
    };

    // Function 1: Get usage count within date range
    public func getUsageInDateRange(adminUUID : Text, fromDate : Int, toDate : Int) : async Text {
        let result = CanDB.get(adminDB, { pk = "adminTable"; sk = adminUUID });
        
        switch (result) {
            case (?entity) {
                switch (entityToAPIKeyData(entity)) {
                    case (null) { return "{}"; };
                    case (?data) {
                        Debug.print("UUID found in DB: ");
                        Debug.print("Existing Usage count: " # Nat.toText(data.usageCount));
                        
                        // Create a map to store counts per timestamp range
                        let timestampMap = HashMap.HashMap<(Int, Int), Nat>(10, func(a, b) {
                            Text.equal(Int.toText(a.0) # Int.toText(a.1), Int.toText(b.0) # Int.toText(b.1))
                        }, func(k) {
                            Text.hash(Int.toText(k.0) # Int.toText(k.1))
                        });
                        
                        // Track total count within range
                        var totalCount = 0;
                        
                        // Process each usage log entry
                        for (entry in data.usageLog.vals()) {
                            if (entry.timestamp >= fromDate and entry.timestamp <= toDate) {
                                // Increment total count
                                totalCount += 1;
                                
                                // Group by day (using timestamp ranges)
                                let dayStart = entry.timestamp / 86_400_000_000_000 * 86_400_000_000_000;
                                let dayEnd = dayStart + 86_399_999_999_999;
                                
                                // If this is the last day in the range, use toDate as the end
                                let adjustedDayEnd = if (dayEnd > toDate) { toDate } else { dayEnd };
                                
                                // Update count for this timestamp range
                                let currentCount = switch (timestampMap.get((dayStart, adjustedDayEnd))) {
                                    case (null) { 0 };
                                    case (?count) { count };
                                };
                                timestampMap.put((dayStart, adjustedDayEnd), currentCount + 1);
                            };
                        };
                        
                        // Build summary information
                        var resultText = "\"fromDate\": " # Int.toText(fromDate) # ",\n";
                        resultText #= "    \"toDate\": " # Int.toText(toDate) # ",\n";
                        resultText #= "    \"usageCount\": " # Nat.toText(totalCount) # ",\n";
                        
                        // Add daily usage array with timestamps
                        resultText #= "    \"dailyUsage\": [\n";

                        var isFirst = true;
                        for (((from, to), count) in timestampMap.entries()) {
                            if (not isFirst) {
                                resultText #= ",\n";
                            };
                            isFirst := false;
                            
                            // This is the corrected JSON format with proper braces and quotes
                            resultText #= "        {\n";
                            resultText #= "            \"value\": " # Nat.toText(count) # ",\n";
                            resultText #= "            \"from\": " # Int.toText(from) # ",\n";
                            resultText #= "            \"to\": " # Int.toText(to) # "\n";
                            resultText #= "        }";
                        };

                        resultText #= "\n    ]";
                        
                        return "{\n    " # resultText # "\n}";
                    };
                };
            };
            case (null) { return "{}"; };
        };
    };

    // Function 2: Get total usage count
    public query func getTotalUsage(adminUUID : Text) : async (Nat, Nat) {
        let result = CanDB.get(adminDB, { pk = "adminTable"; sk = adminUUID });
        
        switch (result) {
            case (?entity) {
                let attributes = entity.attributes;
                Debug.print("UUID found in DB: ");
                
                let usageCount = switch (Entity.getAttributeMapValueForKey(attributes, "usageCount")) {
                    case (?(#int(v))) { Int.abs(v) }; // Convert Int to Nat
                    case _ { 0 };
                };
                
                let usageLimit = switch (Entity.getAttributeMapValueForKey(attributes, "usageLimit")) {
                    case (?(#int(v))) { Int.abs(v) }; // Convert Int to Nat
                    case _ { 0 };
                };
                
                return (usageCount, usageLimit);
            };
            case (null) { return (0, 0) };
        };
    };

    // Function 3: Get API key for UUID
    public query func getAPIKey(adminUUID : Text) : async ?Text {
        let result = CanDB.get(adminDB, { pk = "adminTable"; sk = adminUUID });
        
        switch (result) {
            case (?entity) {
                let attributes = entity.attributes;
                switch (Entity.getAttributeMapValueForKey(attributes, "apiKey")) {
                    case (?(#text(v))) { return ?v }; // Just return the text value directly
                    case _ { return null };
                };
            };
            case (null) { return null };
        };
    };

    // Function to get UUID from API key
    public func getUUIDFromAPIKey(apiKey : Text) : async ?Text {
        // Query all entities with the given partition key
        let skLowerBound = ""; // Start of the range for all keys
        let skUpperBound = "~"; // End of the range for all keys
        let limit = 10000; // Limit number of records to scan
        let ascending = null; // Not specifying order
        
        let { entities } = CanDB.scan(adminDB, {
            skLowerBound = skLowerBound;
            skUpperBound = skUpperBound;
            limit = limit;
            ascending = ascending;
        });
        
        // Use Array.mapFilter to find entities with matching API key
        let matchingUUIDs = Array.mapFilter<Entity.Entity, Text>(
            entities,
            func(entity : Entity.Entity) : ?Text {
                let attributes = entity.attributes;
                switch (Entity.getAttributeMapValueForKey(attributes, "apiKey")) {
                    case (?(#text(storedKey))) {
                        if (Text.equal(storedKey, apiKey)) {
                            ?entity.sk  // Return the UUID (sort key)
                        } else {
                            null
                        };
                    };
                    case _ { null };
                };
            }
        );
        
        // Return the first matching UUID if any were found
        if (matchingUUIDs.size() > 0) {
            ?matchingUUIDs[0]
        } else {
            null
        };
    };

    // Function to record API usage
    public func recordAPIUsage(adminUUID : Text) : async Bool {
        let now = Time.now();
        let result = CanDB.get(adminDB, { pk = "adminTable"; sk = adminUUID });
        
        switch (result) {
            case (?entity) {
                switch (entityToAPIKeyData(entity)) {
                    case (null) { return false };
                    case (?data) {
                        Debug.print("UUID found in DB: ");
                        if (data.usageCount >= data.usageLimit) {
                            return false; // Usage limit exceeded
                        };
                        Debug.print("Existing Usage count: " # Nat.toText(data.usageCount));
                        Debug.print("Usage limit: " # Nat.toText(data.usageLimit));

                        let newCount = data.usageCount + 1;
                        Debug.print("New Usage count: " # Nat.toText(newCount));
                        let newEntry = { timestamp = now };
                        let newLog = Array.append(data.usageLog, [newEntry]);

                        // Update the existing entity with new values
                        let updatedEntity = {
                            pk = entity.pk;
                            sk = entity.sk;
                            attributes = [
                                ("apiKey", #text(data.apiKey)),
                                ("usageCount", #int(newCount)),
                                ("usageLimit", #int(data.usageLimit)),
                                ("usageLog", #arrayInt(Array.map<UsageEntry, Int>(
                                    newLog, 
                                    func(entry : UsageEntry) : Int {
                                        entry.timestamp
                                    }
                                )))
                            ];
                        };

                        await* CanDB.put(adminDB, updatedEntity);
                        return true;
                    };
                };
            };
            case (null) { return false };
        };
    };

    // Creating a new API key
    public func createAPIKey(adminUUID : Text) : async Text {
        let result = CanDB.get(adminDB, { pk = "adminTable"; sk = adminUUID });
        
        switch (result) {
            case (?entity) {
                // UUID already has an API key
                let attributes = entity.attributes;
                switch (Entity.getAttributeMapValueForKey(attributes, "apiKey")) {
                    case (?(#text(apiKey))) { 
                        return apiKey;
                    };
                    case _ { 
                        // This shouldn't happen, but generate a new key just in case
                        return await createNewKey(adminUUID);
                    };
                };
            };
            case (null) {
                return await createNewKey(adminUUID);
            };
        };
    };
    
    // Helper function to create a new key
    func createNewKey(adminUUID : Text) : async Text {
        let apiKey = generateAPIKey(adminUUID);
        let newData = {
            apiKey = apiKey;
            usageCount = 0;
            usageLimit = 10000; // As per your requirement
            usageLog = [];
        };

        let entity = createEntity(adminUUID, newData);
        await* CanDB.put(adminDB, entity);
        
        return apiKey;
    };

    //reset
    public shared func resetAll() : async () {
        // Reinitialize the databases to empty
        clientDB := CanDB.init({
            pk = "clientTable";
            scalingOptions = scalingOptions;
            btreeOrder = null;
        });
        jobDB := CanDB.init({
            pk = "jobTable";
            scalingOptions = scalingOptions;
            btreeOrder = null;
        });
        adminDB := CanDB.init({
            pk = "adminTable";
            scalingOptions = scalingOptions;
            btreeOrder = null;
        });
    };

    // =============== Simple Uptime Tracking Based on Ping Intervals ===============
    
    // Simple WebSocket session tracking without complex time calculations
    public shared func wsCreateSession(userPrincipalId : Text, clientId : Int) : async Text {
        let now = Time.now();
        let sessionId = "session_" # userPrincipalId # "_" # Int.toText(clientId) # "_" # Int.toText(now);
        
        // Simply update client with new session start - no complex daily uptime logic
        let clientResult = CanDB.get(clientDB, { pk = "clientTable"; sk = userPrincipalId });
        switch (clientResult) {
            case (?entity) {
                let updatedAttributes = [
                    ("wsConnect", #int(now)),
                    ("wsDisconnect", #int(0)),
                    ("clientStatus", #text("Active")),
                    ("pingTimestamp", #int(now))
                ];
                
                func updateAttributes(attributeMap : ?Entity.AttributeMap) : Entity.AttributeMap {
                    switch (attributeMap) {
                        case null { Entity.createAttributeMapFromKVPairs(updatedAttributes) };
                        case (?map) { Entity.updateAttributeMapWithKVPairs(map, updatedAttributes) };
                    };
                };
                
                ignore CanDB.update(
                    clientDB,
                    {
                        pk = "clientTable";
                        sk = userPrincipalId;
                        updateAttributeMapFunction = updateAttributes;
                    }
                );
            };
            case null {};
        };
        
        Debug.print("Created WebSocket session: " # sessionId # " for user: " # userPrincipalId);
        return sessionId;
    };

    public shared func wsEndSession(userPrincipalId : Text, reason : Text) : async Result.Result<(), Text> {
        let clientResult = CanDB.get(clientDB, { pk = "clientTable"; sk = userPrincipalId });
        
        switch (clientResult) {
            case (?entity) {
                let now = Time.now();
                
                // Simple session end - just set disconnect time and status
                let updatedAttributes = [
                    ("wsDisconnect", #int(now)),
                    ("clientStatus", #text("Inactive"))
                ];
                
                func updateAttributes(attributeMap : ?Entity.AttributeMap) : Entity.AttributeMap {
                    switch (attributeMap) {
                        case null { Entity.createAttributeMapFromKVPairs(updatedAttributes) };
                        case (?map) { Entity.updateAttributeMapWithKVPairs(map, updatedAttributes) };
                    };
                };
                
                let updateResult = CanDB.update(
                    clientDB,
                    {
                        pk = "clientTable";
                        sk = userPrincipalId;
                        updateAttributeMapFunction = updateAttributes;
                    }
                );
                
                switch (updateResult) {
                    case null { return #err("Failed to update client session") };
                    case (?_) {
                        Debug.print("Ended WebSocket session for user: " # userPrincipalId # " with reason: " # reason);
                        return #ok();
                    };
                };
            };
            case null {
                return #err("Client not found");
            };
        };
    };

    public shared func wsUpdateHeartbeat(userPrincipalId : Text) : async Result.Result<(), Text> {
        let clientResult = CanDB.get(clientDB, { pk = "clientTable"; sk = userPrincipalId });
        
        switch (clientResult) {
            case (?entity) {
                let now = Time.now();
                let updatedAttributes = [
                    ("pingTimestamp", #int(now))
                ];
                
                func updateAttributes(attributeMap : ?Entity.AttributeMap) : Entity.AttributeMap {
                    switch (attributeMap) {
                        case null { Entity.createAttributeMapFromKVPairs(updatedAttributes) };
                        case (?map) { Entity.updateAttributeMapWithKVPairs(map, updatedAttributes) };
                    };
                };
                
                let updateResult = CanDB.update(
                    clientDB,
                    {
                        pk = "clientTable";
                        sk = userPrincipalId;
                        updateAttributeMapFunction = updateAttributes;
                    }
                );
                
                switch (updateResult) {
                    case null { return #err("Failed to update heartbeat") };
                    case (?_) { return #ok() };
                };
            };
            case null {
                return #err("Client not found");
            };
        };
    };

    // Get uptime statistics based on ping intervals (every 10 seconds)
    public query func wsGetUptimeStats(userPrincipalId : Text) : async {
        totalUptime : Int;
        todayUptime : Int;
        isCurrentlyOnline : Bool;
        currentSessionDuration : Int;
    } {
        let clientResult = CanDB.get(clientDB, { pk = "clientTable"; sk = userPrincipalId });
        
        switch (clientResult) {
            case (?entity) {
                let totalUptime = switch (Entity.getAttributeMapValueForKey(entity.attributes, "totalUptime")) {
                    case (?(#int(u))) u;
                    case _ 0;
                };
                
                let dailyUptime = switch (Entity.getAttributeMapValueForKey(entity.attributes, "dailyUptime")) {
                    case (?(#int(u))) u;
                    case _ 0;
                };
                
                let pingTimestamp = switch (Entity.getAttributeMapValueForKey(entity.attributes, "pingTimestamp")) {
                    case (?(#int(t))) t;
                    case _ 0;
                };
                
                let wsConnect = switch (Entity.getAttributeMapValueForKey(entity.attributes, "wsConnect")) {
                    case (?(#int(t))) t;
                    case _ 0;
                };
                
                // Check if user is currently online (last ping within 15 seconds)
                let now = Time.now();
                let isOnline = (now - pingTimestamp) < 15_000_000_000; // 15 seconds in nanoseconds
                
                // Current session duration since connection
                let currentDuration = if (isOnline and wsConnect > 0) now - wsConnect else 0;
                
                {
                    totalUptime = totalUptime;
                    todayUptime = dailyUptime;
                    isCurrentlyOnline = isOnline;
                    currentSessionDuration = currentDuration;
                };
            };
            case null {
                {
                    totalUptime = 0;
                    todayUptime = 0;
                    isCurrentlyOnline = false;
                    currentSessionDuration = 0;
                };
            };
        };
    };

    // Get uptime for reward calculations (simplified)
    public query func wsGetUptimeForRewards(userPrincipalId : Text, startTime : ?Int, endTime : ?Int) : async Int {
        let clientResult = CanDB.get(clientDB, { pk = "clientTable"; sk = userPrincipalId });
        
        switch (clientResult) {
            case (?entity) {
                let totalUptime = switch (Entity.getAttributeMapValueForKey(entity.attributes, "totalUptime")) {
                    case (?(#int(u))) u;
                    case _ 0;
                };
                
                // Simple approach - just return total uptime regardless of time range
                // The complex time range calculations were causing issues
                return totalUptime;
            };
            case null {
                return 0;
            };
        };
    };

    // Cleanup stale WebSocket connections (simplified placeholder)
    public shared func wsCleanupStaleConnections() : async () {
        // Simple cleanup - just mark clients as inactive if they haven't pinged in 5 minutes
        let now = Time.now();
        let staleTimeout : Int = 300_000_000_000; // 5 minutes in nanoseconds
        
        let scanResult = CanDB.scan(
            clientDB,
            {
                skLowerBound = "";
                skUpperBound = "~";
                limit = 1000;
                ascending = null;
                filter = ?{
                    attributeName = "clientStatus";
                    operator = #equal;
                    value = #text("Active");
                };
            }
        );
        
        for (entity in scanResult.entities.vals()) {
            let userPrincipalId = entity.sk;
            let pingTimestamp = switch (Entity.getAttributeMapValueForKey(entity.attributes, "pingTimestamp")) {
                case (?(#int(t))) t;
                case _ 0;
            };
            
            if (now - pingTimestamp > staleTimeout) {
                ignore await wsEndSession(userPrincipalId, "timeout");
                Debug.print("Cleaned up stale connection for user: " # userPrincipalId);
            };
        };
    };

};

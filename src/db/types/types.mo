import Text "mo:base/Text";
import Result "mo:base/Result";
import HTTP "../../common/Http";
import DatabaseOps "../modules/database_ops";

module {
	public type HttpRequest = HTTP.HttpRequest;
	public type HttpResponse = HTTP.HttpResponse;

	type ClientStruct = DatabaseOps.ClientStruct;
    type JobStruct = DatabaseOps.JobStruct;

	public type DatabaseError = {
		#NotFound;
		#AlreadyExists;
		#UpdateFailed;
		#InvalidInput;
		#DatabaseError;
		#Unknown : Text;
	};

	public type EntityResult<T> = {
		#ok : T;
		#err : DatabaseError;
	};

	public type JobState = {
		#pending;
		#ongoing;
		#completed;
		#failed;
	};

	public type ClientState = {
		#working;
		#notWorking;
		#disconnected;
	};

	public type DBInterface = actor {
        login : shared (Text) -> async Result.Result<ClientStruct, Text>;
		getUserRewardHistory : shared (Text) -> async Result.Result<[JobStruct], Text>;
        clientConnect : shared (Text, Int) -> async Result.Result<Text, Text>;
        clientDisconnect : shared (Int) -> async Text;
        updateJobCompleted : shared (Text, Int, Int) -> async Result.Result<Text, Text>;
        updateClientInternetSpeed : shared (Text, Text) -> async Result.Result<Text, Text>;
        clientAuthorization : shared (Text) -> async Result.Result<Text, Text>;
        addJobToDB : shared (Text, Text, Text) -> async Result.Result<Text, Text>;
        assignJobToClient : shared (Text, Int) -> async Result.Result<Text, Text>;
        getJobWithID : shared (Text) -> async Result.Result<JobStruct, Text>;
        getAllNodes : shared () -> async Result.Result<[ClientStruct], Text>;
        getAllRunningNodes : shared () -> async Result.Result<[ClientStruct], Text>;
        getAllJobs : shared (Text) -> async Result.Result<[JobStruct], Text>;
        addRewardsToDB : shared (Text, Float) -> async Result.Result<Float, Text>;
        getAllPendingJobs : shared (Text) -> async Result.Result<[JobStruct], Text>;
		findAndAssignJob : shared (Text) -> async ?{user_principal_id : Text; client_id : Int; downloadSpeed : Float; target : Text; jobType : Text};
		findAndAssignJobToClient : shared (Text, Text) -> async ?{user_principal_id : Text; client_id : Int; downloadSpeed : Float; target : Text; jobType : Text};
		resendJob : shared (Text) -> async ?{user_principal_id : Text; client_id : Int; downloadSpeed : Float; target : Text; jobType : Text};
        wsGetUptimeStats : shared (Text) -> async {
            totalUptime : Int;
            todayUptime : Int;
            isCurrentlyOnline : Bool;
            currentSessionDuration : Int;
        };
        wsCreateSession : shared (Text, Int) -> async Text;
        wsEndSession : shared (Text, Text) -> async Result.Result<(), Text>;
        wsUpdateHeartbeat : shared (Text) -> async Result.Result<(), Text>;
        wsGetUptimeForRewards : shared (Text, ?Int, ?Int) -> async Int;
        wsCleanupStaleConnections : shared () -> async ();
    };
}
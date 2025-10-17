import CanDB "mo:candb/CanDB";
import Entity "mo:candb/Entity";
import Debug "mo:base/Debug";
import Result "mo:base/Result";
import Error "mo:base/Error";
import Float "mo:base/Float";

module {
	public let DEAD_TIMEOUT : Int = 3_600_000_000_000; // 1 hour in nanoseconds

	public type ClientStruct = {
		user_principal_id : Text; 
		client_id : Int;
		jobID : Text;
		jobStatus : Text;
		downloadSpeed : Float;
		ping : Int;
		wsConnect : Int;
		wsDisconnect : Int;
		jobStartTime : Int;
		jobEndTime : Int;
		todaysEarnings: Float;
		balance: Float;
		referralCode: Text;
		totalReferral: Int;
		clientStatus: Text;
		pingTimestamp : Int;
		totalUptime : Int;
		dailyUptime : Int;
	};

	public type JobStruct = {
		jobID : Text;
		clientUUID : Text;
		storedID : Int;
		jobType : Text;
		target : Text;
		state : Text;
		user_principal_id : Text;
		assignedAt : Int;
		completeAt : Int;
		reward: Float;
	};

	public func updateEntity(db : CanDB.DB, pk : Text, sk : Text, updates : [(Text, Entity.AttributeValue)]) : async Result.Result<(), Text> {
		try {
			func updateAttributes(attributeMap : ?Entity.AttributeMap) : Entity.AttributeMap {
				switch (attributeMap) {
					case null Entity.createAttributeMapFromKVPairs(updates);
					case (?map) Entity.updateAttributeMapWithKVPairs(map, updates);
				};
			};

			switch (CanDB.update(db, { sk; updateAttributeMapFunction = updateAttributes })) {
				case null #err("Failed to update entity");
				case (?_) #ok();
			};
		} catch (error) {
			Debug.print("Error in entity update: " # Error.message(error));
			#err("Update failed: " # Error.message(error));
		};
	};

	public func unwrapJobEntity(entity : Entity.Entity) : ?JobStruct {
		let attributes = entity.attributes;
		do ? {
			{
				jobID = switch (Entity.getAttributeMapValueForKey(attributes, "jobID")) {
					case (?(#text(v))) v;
					case _ "";
				};
				clientUUID = switch (Entity.getAttributeMapValueForKey(attributes, "clientUUID")) {
					case (?(#text(v))) v;
					case _ "";
				};
				storedID = switch (Entity.getAttributeMapValueForKey(attributes, "storedID")) {
					case (?(#int(v))) v;
					case _ 0;
				};
				jobType = switch (Entity.getAttributeMapValueForKey(attributes, "jobType")) {
					case (?(#text(v))) v;
					case _ "";
				};
				target = switch (Entity.getAttributeMapValueForKey(attributes, "target")) {
					case (?(#text(v))) v;
					case _ "";
				};
				state = switch (Entity.getAttributeMapValueForKey(attributes, "state")) {
					case (?(#text(v))) v;
					case _ "";
				};
				user_principal_id = switch (Entity.getAttributeMapValueForKey(attributes, "user_principal_id")) {
					case (?(#text(v))) v;
					case _ "";
				};
				assignedAt = switch (Entity.getAttributeMapValueForKey(attributes, "assignedAt")) {
					case (?(#int(v))) v;
					case _ 0;
				};
				completeAt = switch (Entity.getAttributeMapValueForKey(attributes, "completeAt")) {
					case (?(#int(v))) v;
					case _ 0;
				};
				reward = switch (Entity.getAttributeMapValueForKey(attributes, "reward")) {
					case (?(#float(v))) v;
					case _ 0.0;
				};
			};
		};
	};

	public func unwrapClientEntity(entity : Entity.Entity) : ?ClientStruct {
		let attributes = entity.attributes;
		do ? {
			{
				user_principal_id = switch (Entity.getAttributeMapValueForKey(attributes, "user_principal_id")) {
					case (?(#text(v))) v;
					case _ "";
				};
				client_id = switch (Entity.getAttributeMapValueForKey(attributes, "client_id")) {
					case (?(#int(v))) v;
					case _ 0;
				};
				jobID = switch (Entity.getAttributeMapValueForKey(attributes, "jobID")) {
					case (?(#text(v))) v;
					case _ "";
				};
				jobStatus = switch (Entity.getAttributeMapValueForKey(attributes, "jobStatus")) {
					case (?(#text(v))) v;
					case _ "";
				};
				downloadSpeed = switch (Entity.getAttributeMapValueForKey(attributes, "downloadSpeed")) {
					case (?(#float(v))) v;
					case _ 0.0;
				};
				ping = switch (Entity.getAttributeMapValueForKey(attributes, "ping")) {
					case (?(#int(v))) v;
					case _ 0;
				};
				wsConnect = switch (Entity.getAttributeMapValueForKey(attributes, "wsConnect")) {
					case (?(#int(v))) v;
					case _ 0;
				};
				wsDisconnect = switch (Entity.getAttributeMapValueForKey(attributes, "wsDisconnect")) {
					case (?(#int(v))) v;
					case _ 0;
				};
				jobStartTime = switch (Entity.getAttributeMapValueForKey(attributes, "jobStartTime")) {
					case (?(#int(v))) v;
					case _ 0;
				};
				jobEndTime = switch (Entity.getAttributeMapValueForKey(attributes, "jobEndTime")) {
					case (?(#int(v))) v;
					case _ 0;
				};
				todaysEarnings = switch (Entity.getAttributeMapValueForKey(attributes, "todaysEarnings")) {
					case (?(#float(v))) v;
					case _ 0.0;
				};
				balance = switch (Entity.getAttributeMapValueForKey(attributes, "balance")) {
					case (?(#float(v))) v;
					case _ 0.0;
				};
				referralCode = switch (Entity.getAttributeMapValueForKey(attributes, "referralCode")) {
					case (?(#text(v))) v;
					case _ "";
				};
				totalReferral = switch (Entity.getAttributeMapValueForKey(attributes, "totalReferral")) {
					case (?(#int(v))) v;
					case _ 0;
				};
				clientStatus = switch (Entity.getAttributeMapValueForKey(attributes, "clientStatus")) {
					case (?(#text(v))) v;
					case _ "";
				};
				pingTimestamp = switch (Entity.getAttributeMapValueForKey(attributes, "pingTimestamp")) {
					case (?(#int(v))) v;
					case _ 0;
				};
				totalUptime = switch (Entity.getAttributeMapValueForKey(attributes, "totalUptime")) {
					case (?(#int(v))) v;
					case _ 0;
				};
				dailyUptime = switch (Entity.getAttributeMapValueForKey(attributes, "dailyUptime")) {
					case (?(#int(v))) v;
					case _ 0;
				};
			};
		};
	};
}
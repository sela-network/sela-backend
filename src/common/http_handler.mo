import Text "mo:base/Text";
import HTTP "./Http";

module {
	public type HttpRequest = HTTP.HttpRequest;
	public type HttpResponse = HTTP.HttpResponse;

	public func badRequest(msg : Text) : HttpResponse {
		{
			status_code = 400;
			headers = [("Content-Type", "text/plain")];
			body = Text.encodeUtf8(msg);
			streaming_strategy = null;
			upgrade = null;
		};
	};

	public func unauthorized(msg : Text) : HttpResponse {
		{
			status_code = 403;
			headers = [("Content-Type", "text/plain")];
			body = Text.encodeUtf8(msg);
			streaming_strategy = null;
			upgrade = null;
		};
	};

	public func notFound() : HttpResponse {
		{
			status_code = 404;
			headers = [("Content-Type", "text/plain")];
			body = Text.encodeUtf8("Not Found");
			streaming_strategy = null;
			upgrade = null;
		};
	};

	public func getHeader(headers : [(Text, Text)], name : Text) : ?Text {
		for ((key, value) in headers.vals()) {
			if (Text.equal(key, name)) {
				return ?value;
			};
		};
		null;
	};

	public func createJsonResponse(status : Text, message : Text, user_principal_id : Text, state : Text) : Text {
		"{" #
		"\"status\": \"" # status # "\"," #
		"\"message\": \"" # message # "\"," #
		"\"user_principal_id\": \"" # user_principal_id # "\"," #
		"\"state\": \"" # state # "\"" #
		"}";
	};
}
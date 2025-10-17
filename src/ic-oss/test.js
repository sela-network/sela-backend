const base64Content = "VGhpcyBpcyBhIHRlc3QgZmlsZQo=";
const binaryContent = atob(base64Content);
const bytes = new Uint8Array(binaryContent.length);
for (let i = 0; i < binaryContent.length; i++) {
    bytes[i] = binaryContent.charCodeAt(i);
}
const blob = new Blob([bytes], { type: "text/plain" });

console.log("Blob size:", blob);

const reader = new FileReader();
reader.onload = function() {
    console.log("Blob content:", reader.result);
};
reader.readAsText(blob);

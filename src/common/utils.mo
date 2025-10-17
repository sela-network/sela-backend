import Nat = "mo:base/Nat";
import Nat8 = "mo:base/Nat8";
import Random = "mo:base/Random";
import Blob "mo:base/Blob";
import Text "mo:base/Text";
import Iter "mo:base/Iter";
import Char "mo:base/Char";
import Nat32 "mo:base/Nat32";

module {
  public func new() : { next : () -> async Text } = object {
    public func next() : async Text {
      let randomBytes = await Random.blob();
      let randomNat = bytesToNat(Blob.toArray(randomBytes));
      let trimmedNat = randomNat % 1000000; // This will give a number between 0 and 999999
      padWithZeros(Nat.toText(trimmedNat), 6);
    };
  };

  private func bytesToNat(bytes : [Nat8]) : Nat {
    var n : Nat = 0;
    for (byte in bytes.vals()) {
      n := n * 256 + Nat8.toNat(byte);
    };
    n;
  };

  private func padWithZeros(s : Text, desiredLength : Nat) : Text {
    let currentLength = s.size();
    if (currentLength >= desiredLength) {
      s;
    } else {
      var padded = s;
      for (i in Iter.range(0, desiredLength - currentLength - 1)) {
        padded := "0" # padded;
      };
      padded;
    };
  };

  public func findSubstring(text : Text, pattern : Text) : ?Nat {
    let textIter = text.chars();
    let patternIter = pattern.chars();
    var index : Nat = 0;

    label search loop {
      let startIndex = index;
      for (patternChar in patternIter) {
        switch (textIter.next()) {
          case (?textChar) {
            if (textChar != patternChar) {
              index += 1;
              continue search;
            };
          };
          case (null) return null;
        };
      };
      return ?startIndex;
    };

    null;
  };

  public func textToInt(text : Text) : Int {
    var int : Int = 0;
    for (char in text.chars()) {
      if (Char.isDigit(char)) {
        let digit = Nat32.toNat(Char.toNat32(char) - Char.toNat32('0'));
        int := int * 10 + digit;
      };
    };
    int;
  };
};

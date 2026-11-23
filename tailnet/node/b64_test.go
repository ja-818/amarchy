package node

import "encoding/base64"

func encodeStd(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

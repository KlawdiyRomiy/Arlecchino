package lsp

import (
	stdjson "encoding/json"

	fastjson "github.com/goccy/go-json"
	"go.lsp.dev/jsonrpc2"
)

type LSPCodec interface {
	Marshal(v any) ([]byte, error)
	Unmarshal(data []byte, v any) error
	DecodeMessage(data []byte) (jsonrpc2.Message, error)
	Name() string
}

type stdlibCodec struct{}

func (stdlibCodec) Marshal(v any) ([]byte, error) {
	return stdjson.Marshal(v)
}

func (stdlibCodec) Unmarshal(data []byte, v any) error {
	return stdjson.Unmarshal(data, v)
}

func (stdlibCodec) DecodeMessage(data []byte) (jsonrpc2.Message, error) {
	return jsonrpc2.DecodeMessage(data)
}

func (stdlibCodec) Name() string {
	return "encoding/json"
}

type goccyCodec struct{}

func (goccyCodec) Marshal(v any) ([]byte, error) {
	return fastjson.Marshal(v)
}

func (goccyCodec) Unmarshal(data []byte, v any) error {
	return fastjson.Unmarshal(data, v)
}

func (goccyCodec) DecodeMessage(data []byte) (jsonrpc2.Message, error) {
	return jsonrpc2.DecodeMessage(data)
}

func (goccyCodec) Name() string {
	return "goccy/go-json"
}

func DefaultLSPCodec() LSPCodec {
	return stdlibCodec{}
}

func FastLSPCodecForBenchmarks() LSPCodec {
	return goccyCodec{}
}

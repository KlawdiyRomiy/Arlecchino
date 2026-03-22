package mcp

import (
	"context"
	"io"
)

func RunStdioServer(ctx context.Context, projectRoot string, in io.Reader, out io.Writer, errOut io.Writer) error {
	service, err := NewToolServiceWithOptions(projectRoot, ToolServiceOptions{
		EnableBridgeAutoDetect: true,
	})
	if err != nil {
		return err
	}

	server := NewServer(service, in, out, errOut)
	return server.Serve(ctx)
}

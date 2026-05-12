package mcp

import (
	"context"
	"fmt"
	"io"
)

func RunStdioServer(ctx context.Context, projectRoot string, in io.Reader, out io.Writer, errOut io.Writer) error {
	settings, _, err := LoadSettings("")
	if err != nil {
		return err
	}
	if !settings.Enabled {
		if errOut != nil {
			fmt.Fprintln(errOut, "Arlecchino MCP is disabled in Settings > MCP.")
		}
		return nil
	}

	service, err := NewToolServiceWithOptions(projectRoot, ToolServiceOptions{
		EnableBridgeAutoDetect: true,
	})
	if err != nil {
		return err
	}

	server := NewServer(service, in, out, errOut)
	return server.Serve(ctx)
}

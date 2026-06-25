//go:build windows

package lsp

import "fmt"

func lspProcessRSSBytes(pid int) (int64, error) {
	return 0, fmt.Errorf("lsp rss sampling is not implemented on windows for pid %d", pid)
}

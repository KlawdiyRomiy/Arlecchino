//go:build !darwin || !cgo

package app

import "fmt"

func moveProjectEntryToTrashOnDarwinWithResult(string) (string, error) {
	return "", fmt.Errorf("native macOS Trash support is unavailable")
}

func moveProjectEntryFromTrashOnDarwin(string, string) error {
	return fmt.Errorf("native macOS Trash support is unavailable")
}

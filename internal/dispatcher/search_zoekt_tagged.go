//go:build arlecchino_zoekt

package dispatcher

func NewZoektSearchBackend(projectPath string) (SearchBackend, error) {
	return nil, ErrZoektBackendUnavailable
}

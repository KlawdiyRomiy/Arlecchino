package terminal

import "fmt"

const (
	MaxRows    = 300
	MaxColumns = 500
)

func ValidateSize(rows int, columns int) error {
	if rows < 1 || rows > MaxRows {
		return fmt.Errorf("terminal rows must be between 1 and %d", MaxRows)
	}
	if columns < 1 || columns > MaxColumns {
		return fmt.Errorf("terminal columns must be between 1 and %d", MaxColumns)
	}
	return nil
}

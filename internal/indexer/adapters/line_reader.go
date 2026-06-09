package adapters

import (
	"bufio"
	"bytes"
	"errors"
	"io"
	"os"
)

const (
	indexLineReaderBufferBytes = 64 << 10
)

const indexLineRetainedBufferBytes = indexLineReaderBufferBytes * 4

type indexLineVisitor func(lineNum int, line string) error
type indexLineIterator func(indexLineVisitor) error

func fileLineIterator(path string) indexLineIterator {
	return func(visit indexLineVisitor) error {
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		return forEachIndexLine(file, visit)
	}
}

func contentLineIterator(content []byte) indexLineIterator {
	return func(visit indexLineVisitor) error {
		return forEachIndexLine(bytes.NewReader(content), visit)
	}
}

func forEachIndexLine(reader io.Reader, visit indexLineVisitor) error {
	if visit == nil {
		return nil
	}

	buffered := bufio.NewReaderSize(reader, indexLineReaderBufferBytes)
	lineNum := 0
	line := make([]byte, 0, indexLineReaderBufferBytes)

	for {
		fragment, err := buffered.ReadSlice('\n')
		if len(fragment) > 0 {
			line = append(line, fragment...)
		}

		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}

		if len(fragment) > 0 {
			lineNum++
			trimmed := trimLineEnding(line)
			if visitErr := visit(lineNum, string(trimmed)); visitErr != nil {
				return visitErr
			}
			line = resetLineBuffer(line)
		}

		if err == nil {
			continue
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		return err
	}
}

func resetLineBuffer(line []byte) []byte {
	if cap(line) > indexLineRetainedBufferBytes {
		return make([]byte, 0, indexLineReaderBufferBytes)
	}
	return line[:0]
}

func trimLineEnding(line []byte) []byte {
	if len(line) > 0 && line[len(line)-1] == '\n' {
		line = line[:len(line)-1]
	}
	if len(line) > 0 && line[len(line)-1] == '\r' {
		line = line[:len(line)-1]
	}
	return line
}

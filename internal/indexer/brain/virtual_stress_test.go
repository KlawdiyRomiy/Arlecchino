package brain

import (
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"arlecchino/internal/indexer/core"
)

func TestVirtualStore_Stress(t *testing.T) {
	// Setup temporary DB
	tmpDir, err := os.MkdirTemp("", "arlecchino_stress_test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	dbPath := filepath.Join(tmpDir, "index.db")
	store, err := core.NewStore(dbPath, "test_project")
	if err != nil {
		t.Fatal(err)
	}

	// Initialize VirtualStore
	vs := NewVirtualStore(store, time.Minute)

	// Configuration
	const (
		numGoroutines = 10
		numOperations = 100
		fileCount     = 5
	)

	var wg sync.WaitGroup
	start := time.Now()

	// Simulate concurrent typing (Add) and reading (Get)
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			r := rand.New(rand.NewSource(time.Now().UnixNano() + int64(id)))

			for j := 0; j < numOperations; j++ {
				fileIdx := r.Intn(fileCount)
				filePath := fmt.Sprintf("/path/to/file_%d.php", fileIdx)
				symbolName := fmt.Sprintf("Symbol_%d_%d", id, j)

				// Randomly choose between Add (typing) and Get (predicting)
				if r.Float32() < 0.7 { // 70% writes (typing is fast)
					sym := core.Symbol{
						ID:       fmt.Sprintf("%s:%s", filePath, symbolName),
						Name:     symbolName,
						FilePath: filePath,
						Kind:     "function",
						Line:     r.Intn(1000),
						Language: "php",
					}
					vs.Add(sym, "stress_test")
				} else {
					// Read
					vs.Get(filePath, "php")
				}

				// Simulate tiny delay between keystrokes
				time.Sleep(time.Microsecond * 100)
			}
		}(i)
	}

	wg.Wait()
	duration := time.Since(start)

	t.Logf("Completed %d operations across %d goroutines in %v", numOperations*numGoroutines, numGoroutines, duration)

	// Verify consistency
	// Check if we can retrieve symbols for one of the files
	entries := vs.Get("/path/to/file_0.php", "php")
	t.Logf("Retrieved %d virtual entries for file_0.php", len(entries))

	for _, entry := range entries {
		if !entry.Symbol.IsPending {
			t.Errorf("Expected symbol %s to be pending", entry.Symbol.Name)
		}
	}
}

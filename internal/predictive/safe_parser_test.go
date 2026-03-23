package predictive

import (
	"sync"
	"testing"
	"time"
)

func TestSafeParser_ConcurrentParsing(t *testing.T) {
	sp := GetSafeParser()

	phpCode := []byte(`<?php
class User {
    public function getName(): string {
        return $this->name;
    }
}`)

	goCode := []byte(`package main

func main() {
    fmt.Println("Hello")
}`)

	tsCode := []byte(`class App {
    constructor() {}
    render(): void {}
}`)

	pyCode := []byte(`class Model:
    def __init__(self):
        pass
    def save(self):
        pass`)

	jsCode := []byte(`function hello() {
    console.log("world");
}`)

	var wg sync.WaitGroup
	errors := make(chan error, 100)

	for i := 0; i < 20; i++ {
		wg.Add(5)

		go func() {
			defer wg.Done()
			tree, err := sp.Parse("php", phpCode)
			if err != nil {
				errors <- err
				return
			}
			if tree != nil {
				tree.Close()
			}
		}()

		go func() {
			defer wg.Done()
			tree, err := sp.Parse("go", goCode)
			if err != nil {
				errors <- err
				return
			}
			if tree != nil {
				tree.Close()
			}
		}()

		go func() {
			defer wg.Done()
			tree, err := sp.Parse("typescript", tsCode)
			if err != nil {
				errors <- err
				return
			}
			if tree != nil {
				tree.Close()
			}
		}()

		go func() {
			defer wg.Done()
			tree, err := sp.Parse("python", pyCode)
			if err != nil {
				errors <- err
				return
			}
			if tree != nil {
				tree.Close()
			}
		}()

		go func() {
			defer wg.Done()
			tree, err := sp.Parse("javascript", jsCode)
			if err != nil {
				errors <- err
				return
			}
			if tree != nil {
				tree.Close()
			}
		}()
	}

	wg.Wait()
	close(errors)

	for err := range errors {
		t.Errorf("Parse error: %v", err)
	}
}

func TestSafeParser_PriorityHighBeforeLow(t *testing.T) {
	sp := GetSafeParser()

	code := []byte(`<?php echo "test";`)

	lowDone := make(chan struct{})
	highDone := make(chan struct{})

	go func() {
		for i := 0; i < 10; i++ {
			tree, _ := sp.ParseLowPriority("php", code)
			if tree != nil {
				tree.Close()
			}
		}
		close(lowDone)
	}()

	time.Sleep(5 * time.Millisecond)

	go func() {
		tree, _ := sp.Parse("php", code)
		if tree != nil {
			tree.Close()
		}
		close(highDone)
	}()

	select {
	case <-highDone:
	case <-time.After(500 * time.Millisecond):
		t.Error("High priority request took too long")
	}

	<-lowDone
}

func TestSafeParser_AllLanguagesWork(t *testing.T) {
	sp := GetSafeParser()

	tests := []struct {
		lang string
		code []byte
	}{
		{"php", []byte(`<?php class Foo {}`)},
		{"go", []byte(`package main`)},
		{"typescript", []byte(`const x: number = 1;`)},
		{"javascript", []byte(`const x = 1;`)},
		{"python", []byte(`def foo(): pass`)},
		{"ts", []byte(`let y: string = "";`)},
		{"js", []byte(`let y = "";`)},
		{"py", []byte(`class Bar: pass`)},
		{"tsx", []byte(`const App = () => <div/>;`)},
		{"jsx", []byte(`const App = () => <div/>;`)},
	}

	for _, tt := range tests {
		t.Run(tt.lang, func(t *testing.T) {
			tree, err := sp.Parse(tt.lang, tt.code)
			if err != nil {
				t.Errorf("Parse(%s) error: %v", tt.lang, err)
			}
			if tree == nil && tt.lang != "unknown" {
				t.Errorf("Parse(%s) returned nil tree", tt.lang)
			}
			if tree != nil {
				tree.Close()
			}
		})
	}
}

func BenchmarkSafeParser_Parse(b *testing.B) {
	sp := GetSafeParser()
	code := []byte(`<?php
class UserController extends Controller {
    public function index(): Response {
        $users = User::all();
        return response()->json($users);
    }
    
    public function show(int $id): Response {
        $user = User::findOrFail($id);
        return response()->json($user);
    }
}`)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tree, _ := sp.Parse("php", code)
		if tree != nil {
			tree.Close()
		}
	}
}

func BenchmarkSafeParser_ConcurrentMultiLang(b *testing.B) {
	sp := GetSafeParser()

	codes := map[string][]byte{
		"php":        []byte(`<?php class Foo { public function bar() {} }`),
		"go":         []byte(`package main; func main() { println("hi") }`),
		"typescript": []byte(`class App { render(): void {} }`),
		"python":     []byte(`class Model: def save(self): pass`),
		"javascript": []byte(`function test() { return 42; }`),
	}

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		langs := []string{"php", "go", "typescript", "python", "javascript"}
		for pb.Next() {
			lang := langs[i%5]
			tree, _ := sp.Parse(lang, codes[lang])
			if tree != nil {
				tree.Close()
			}
			i++
		}
	})
}

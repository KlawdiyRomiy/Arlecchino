package predictive

import (
	"context"
	"fmt"
	"runtime"
	"sync"

	sitter "github.com/smacker/go-tree-sitter"
	"github.com/smacker/go-tree-sitter/golang"
	"github.com/smacker/go-tree-sitter/javascript"
	"github.com/smacker/go-tree-sitter/php"
	"github.com/smacker/go-tree-sitter/python"
	"github.com/smacker/go-tree-sitter/ruby"
	"github.com/smacker/go-tree-sitter/typescript/typescript"
)

type Priority int

const (
	PriorityHigh Priority = iota
	PriorityLow
)

type parseRequest struct {
	content  []byte
	priority Priority
	result   chan parseResult
}

type parseResult struct {
	tree *sitter.Tree
	err  error
}

type languageWorker struct {
	parser   *sitter.Parser
	highPrio chan parseRequest
	lowPrio  chan parseRequest
	stopCh   chan struct{}
	wg       sync.WaitGroup
}

type SafeParser struct {
	workers map[string]*languageWorker
	mu      sync.RWMutex
	closed  bool
}

var (
	globalSafeParser *SafeParser
	safeParserOnce   sync.Once
)

func GetSafeParser() *SafeParser {
	safeParserOnce.Do(func() {
		globalSafeParser = newSafeParser()
	})
	return globalSafeParser
}

func newSafeParser() *SafeParser {
	sp := &SafeParser{
		workers: make(map[string]*languageWorker),
	}

	languages := map[string]*sitter.Language{
		"php":        php.GetLanguage(),
		"go":         golang.GetLanguage(),
		"javascript": javascript.GetLanguage(),
		"typescript": typescript.GetLanguage(),
		"python":     python.GetLanguage(),
		"ruby":       ruby.GetLanguage(),
	}

	for lang, langDef := range languages {
		parser := sitter.NewParser()
		parser.SetLanguage(langDef)

		worker := &languageWorker{
			parser:   parser,
			highPrio: make(chan parseRequest, 50),
			lowPrio:  make(chan parseRequest, 200),
			stopCh:   make(chan struct{}),
		}

		worker.wg.Add(1)
		go worker.run()

		sp.workers[lang] = worker
		fmt.Printf("[SafeParser] Started worker for %s\n", lang)
	}

	fmt.Printf("[SafeParser] Initialized with %d language workers\n", len(sp.workers))
	return sp
}

func (w *languageWorker) run() {
	defer w.wg.Done()

	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	for {
		select {
		case <-w.stopCh:
			return
		case req := <-w.highPrio:
			w.process(req)
		default:
			select {
			case <-w.stopCh:
				return
			case req := <-w.highPrio:
				w.process(req)
			case req := <-w.lowPrio:
				w.process(req)
			}
		}
	}
}

func (w *languageWorker) process(req parseRequest) {
	defer func() {
		if r := recover(); r != nil {
			req.result <- parseResult{tree: nil, err: fmt.Errorf("parser panic: %v", r)}
		}
	}()

	tree, err := w.parser.ParseCtx(context.Background(), nil, req.content)
	req.result <- parseResult{tree: tree, err: err}
}

func (sp *SafeParser) getWorker(language string) *languageWorker {
	sp.mu.RLock()
	defer sp.mu.RUnlock()

	if worker, ok := sp.workers[language]; ok {
		return worker
	}

	switch language {
	case "tsx", "jsx", "ts", "typescriptreact":
		return sp.workers["typescript"]
	case "js", "javascriptreact":
		return sp.workers["javascript"]
	case "py":
		return sp.workers["python"]
	}

	return nil
}

func (sp *SafeParser) Parse(language string, content []byte) (*sitter.Tree, error) {
	return sp.ParseWithPriority(language, content, PriorityHigh)
}

func (sp *SafeParser) ParseLowPriority(language string, content []byte) (*sitter.Tree, error) {
	return sp.ParseWithPriority(language, content, PriorityLow)
}

func (sp *SafeParser) ParseWithPriority(language string, content []byte, priority Priority) (*sitter.Tree, error) {
	worker := sp.getWorker(language)
	if worker == nil {
		return nil, nil
	}

	resultCh := make(chan parseResult, 1)
	req := parseRequest{
		content:  content,
		priority: priority,
		result:   resultCh,
	}

	if priority == PriorityHigh {
		select {
		case worker.highPrio <- req:
		case <-worker.stopCh:
			return nil, nil
		}
	} else {
		select {
		case worker.lowPrio <- req:
		case <-worker.stopCh:
			return nil, nil
		}
	}

	result := <-resultCh
	return result.tree, result.err
}

func (sp *SafeParser) ParseWithContext(ctx context.Context, language string, content []byte) (*sitter.Tree, error) {
	worker := sp.getWorker(language)
	if worker == nil {
		return nil, nil
	}

	resultCh := make(chan parseResult, 1)
	req := parseRequest{
		content:  content,
		priority: PriorityHigh,
		result:   resultCh,
	}

	select {
	case worker.highPrio <- req:
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-worker.stopCh:
		return nil, nil
	}

	select {
	case result := <-resultCh:
		return result.tree, result.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (sp *SafeParser) Close() {
	sp.mu.Lock()
	if sp.closed {
		sp.mu.Unlock()
		return
	}
	sp.closed = true
	sp.mu.Unlock()

	for _, worker := range sp.workers {
		close(worker.stopCh)
		worker.wg.Wait()
		worker.parser.Close()
	}
}

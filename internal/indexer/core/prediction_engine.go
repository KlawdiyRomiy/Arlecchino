package core

import (
	"path/filepath"
)

type PredictionEngine struct {
	engine  *Engine
	workers int
}

type PredictionConfig struct {
	ProjectID   string
	ProjectRoot string
	DataDir     string
	Workers     int
	Languages   []string
	Framework   string
}

func NewPredictionEngine(cfg PredictionConfig) (*PredictionEngine, error) {
	if cfg.Workers == 0 {
		cfg.Workers = RecommendedWorkerCount()
	}
	if cfg.DataDir == "" {
		cfg.DataDir = filepath.Join(cfg.ProjectRoot, ".arlecchino")
	}

	dbPath := filepath.Join(cfg.DataDir, "index.db")

	engine, err := NewEngine(EngineConfig{
		ProjectID:   cfg.ProjectID,
		ProjectRoot: cfg.ProjectRoot,
		DBPath:      dbPath,
		Workers:     cfg.Workers,
	})
	if err != nil {
		return nil, err
	}

	return &PredictionEngine{
		engine:  engine,
		workers: cfg.Workers,
	}, nil
}

func (p *PredictionEngine) RegisterAdapter(adapter LanguageAdapter) {
	p.engine.RegisterAdapter(adapter)
}

func (p *PredictionEngine) Start() {
	p.engine.Start()
}

func (p *PredictionEngine) Stop() {
	p.engine.Stop()
}

func (p *PredictionEngine) IndexProject() {
	p.engine.IndexProject()
}

func (p *PredictionEngine) IndexFile(path string) {
	p.engine.IndexFile(path, 10)
}

func (p *PredictionEngine) OnFileCreated(path string, content []byte) {
	p.engine.OnFileCreated(path, content)
}

func (p *PredictionEngine) OnFileSaved(path string) {
	p.engine.OnFileSaved(path)
}

func (p *PredictionEngine) OnFileDeleted(path string) {
	p.engine.OnFileDeleted(path)
}

func (p *PredictionEngine) OnFileChanged(path string, content []byte) {
	p.engine.OnFileChanged(path, content)
}

func (p *PredictionEngine) Query(q SymbolQuery) ([]Symbol, error) {
	return p.engine.Query(q)
}

func (p *PredictionEngine) QueryEdges(q EdgeQuery) ([]Edge, error) {
	return p.engine.QueryEdges(q)
}

func (p *PredictionEngine) Stats() EngineStats {
	return p.engine.Stats()
}

func (p *PredictionEngine) Engine() *Engine {
	return p.engine
}

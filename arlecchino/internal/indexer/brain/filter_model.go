package brain

import (
	"math"
	"strings"
	"sync"
	"time"

	"arlecchino/internal/indexer/core"
)

type FilterFeatures struct {
	PrefixLength        int
	CompletionLength    int
	GapPercentage       float64
	Source              core.SymbolSource
	TypingSpeed         float64
	AcceptanceRate      float64
	TimeSinceLastAccept time.Duration
	MatchScore          float64
	Confidence          float64
	Language            string
	IsMethodCall        bool
	IsStaticCall        bool
	IsIdle              bool
	AccessChain         string
}

type FilterModel struct {
	mu            sync.RWMutex
	weights       filterWeights
	langWeights   map[string]float64
	sourceWeights map[core.SymbolSource]float64
}

type filterWeights struct {
	PrefixLength        float64
	CompletionLength    float64
	GapPercentage       float64
	TypingSpeed         float64
	AcceptanceRate      float64
	TimeSinceLastAccept float64
	MatchScore          float64
	Confidence          float64
	Source              float64
	Language            float64
	ContextCall         float64
	IdleMode            float64
	Bias                float64
}

func NewFilterModel() *FilterModel {
	return &FilterModel{
		weights: filterWeights{
			PrefixLength:        0.15,
			CompletionLength:    -0.05,
			GapPercentage:       0.25,
			TypingSpeed:         0.05,
			AcceptanceRate:      0.15,
			TimeSinceLastAccept: -0.05,
			MatchScore:          0.20,
			Confidence:          0.10,
			Source:              0.05,
			Language:            0.03,
			ContextCall:         0.02,
			IdleMode:            0.06,
			Bias:                0.3,
		},
		langWeights: map[string]float64{
			"go":         1.0,
			"typescript": 1.0,
			"javascript": 0.95,
			"python":     1.0,
			"rust":       1.0,
			"php":        0.9,
			"ruby":       0.9,
			"java":       0.9,
			"csharp":     0.9,
			"cpp":        0.85,
			"c":          0.85,
		},
		sourceWeights: map[core.SymbolSource]float64{
			core.SourceLSP:        1.0,
			core.SourceFillAll:    0.95,
			core.SourceLocal:      0.9,
			core.SourceKeywords:   0.85,
			core.SourceAST:        0.8,
			core.SourcePredictive: 0.75,
			core.SourceIndex:      0.7,
			core.SourceVirtual:    0.6,
		},
	}
}

func (f *FilterModel) ShouldShow(features FilterFeatures) bool {
	score := f.Predict(features)
	return score > 0.5
}

func (f *FilterModel) Predict(features FilterFeatures) float64 {
	f.mu.RLock()
	defer f.mu.RUnlock()

	score := f.weights.Bias

	prefixScore := math.Min(float64(features.PrefixLength)/5.0, 1.0)
	score += prefixScore * f.weights.PrefixLength

	completionPenalty := math.Min(float64(features.CompletionLength)/50.0, 1.0)
	score += completionPenalty * f.weights.CompletionLength

	score += features.GapPercentage * f.weights.GapPercentage

	typingScore := math.Min(features.TypingSpeed/10.0, 1.0)
	score += typingScore * f.weights.TypingSpeed

	score += features.AcceptanceRate * f.weights.AcceptanceRate

	recencyScore := 1.0
	if features.TimeSinceLastAccept > 0 {
		recencyScore = math.Max(0, 1.0-features.TimeSinceLastAccept.Seconds()/60.0)
	}
	score += recencyScore * f.weights.TimeSinceLastAccept

	score += features.MatchScore * f.weights.MatchScore

	score += features.Confidence * f.weights.Confidence

	sourceWeight := 0.7
	if w, ok := f.sourceWeights[features.Source]; ok {
		sourceWeight = w
	}
	score += sourceWeight * f.weights.Source

	langWeight := 0.85
	if w, ok := f.langWeights[features.Language]; ok {
		langWeight = w
	}
	score += langWeight * f.weights.Language

	if features.IsMethodCall || features.IsStaticCall {
		score += f.weights.ContextCall
	}

	if features.IsIdle {
		score += f.weights.IdleMode
	}

	return sigmoid(score)
}

func (f *FilterModel) PredictWithThreshold(features FilterFeatures, threshold float64) bool {
	return f.Predict(features) > threshold
}

func sigmoid(x float64) float64 {
	return 1.0 / (1.0 + math.Exp(-x))
}

type GhostTextFilter struct {
	model            *FilterModel
	minPrefixLength  int
	minGap           float64
	maxCompletionLen int
	idleTimeout      time.Duration
	activeTokenLimit int
	idleTokenLimit   int
}

type GhostFilterContext struct {
	Prefix       string
	Language     string
	Suggestions  []Suggestion
	IsMethodCall bool
	IsStaticCall bool
	AccessChain  string
	UserBehavior *UserBehavior
	Now          time.Time
	ActiveMaxLen int
	IdleMaxLen   int
	ActiveMinGap float64
	IdleMinGap   float64
	ActiveTokens int
	IdleTokens   int
}

func NewGhostTextFilter() *GhostTextFilter {
	return &GhostTextFilter{
		model:            NewFilterModel(),
		minPrefixLength:  1,
		minGap:           0.10,
		maxCompletionLen: 100,
		idleTimeout:      900 * time.Millisecond,
		activeTokenLimit: 5,
		idleTokenLimit:   24,
	}
}

func (g *GhostTextFilter) ShouldShowGhost(ctx GhostFilterContext) bool {
	if len(ctx.Suggestions) == 0 {
		return false
	}

	if len(ctx.Prefix) < g.minPrefixLength && ctx.AccessChain == "" {
		return false
	}

	now := ctx.Now
	if now.IsZero() {
		now = time.Now()
	}

	top := ctx.Suggestions[0]

	maxLen := g.maxCompletionLen
	if ctx.ActiveMaxLen > 0 || ctx.IdleMaxLen > 0 {
		if isIdle(ctx.UserBehavior, now, g.idleTimeout) {
			if ctx.IdleMaxLen > 0 {
				maxLen = ctx.IdleMaxLen
			}
		} else if ctx.ActiveMaxLen > 0 {
			maxLen = ctx.ActiveMaxLen
		}
	}

	if len(top.Text) > maxLen {
		return false
	}

	tokenLimit := g.activeTokenLimit
	if ctx.ActiveTokens > 0 {
		tokenLimit = ctx.ActiveTokens
	}
	if isIdle(ctx.UserBehavior, now, g.idleTimeout) {
		if ctx.IdleTokens > 0 {
			tokenLimit = ctx.IdleTokens
		} else {
			tokenLimit = g.idleTokenLimit
		}
	}
	if tokenLimit > 0 && countTokens(top.Text) > tokenLimit {
		return false
	}

	gap := 0.0
	if len(ctx.Suggestions) > 1 && top.Score > 0 {
		gap = (top.Score - ctx.Suggestions[1].Score) / top.Score
	} else if len(ctx.Suggestions) == 1 {
		gap = 1.0
	}

	minGap := g.minGap
	if isIdle(ctx.UserBehavior, now, g.idleTimeout) {
		if ctx.IdleMinGap > 0 {
			minGap = ctx.IdleMinGap
		}
	} else if ctx.ActiveMinGap > 0 {
		minGap = ctx.ActiveMinGap
	}

	if gap < minGap {
		return false
	}

	features := FilterFeatures{
		PrefixLength:     len(ctx.Prefix),
		CompletionLength: len(top.Text),
		GapPercentage:    gap,
		Source:           top.Source,
		MatchScore:       0.5,
		Confidence:       top.Confidence,
		Language:         ctx.Language,
		IsMethodCall:     ctx.IsMethodCall,
		IsStaticCall:     ctx.IsStaticCall,
		IsIdle:           isIdle(ctx.UserBehavior, now, g.idleTimeout),
		AccessChain:      ctx.AccessChain,
	}

	if top.MatchResult != nil {
		features.MatchScore = top.MatchResult.Score
	}

	if ctx.UserBehavior != nil {
		features.TypingSpeed = ctx.UserBehavior.TypingSpeed
		features.AcceptanceRate = ctx.UserBehavior.AcceptanceRate
		if !ctx.UserBehavior.LastAcceptedAt.IsZero() {
			features.TimeSinceLastAccept = time.Since(ctx.UserBehavior.LastAcceptedAt)
		}
	}

	if ctx.UserBehavior != nil {
		lastRejected := ctx.UserBehavior.GetLastRejectedAt()
		if !lastRejected.IsZero() && lastRejected.After(now.Add(-45*time.Second)) {
			return false
		}
	}

	threshold := 0.5
	if isIdle(ctx.UserBehavior, now, g.idleTimeout) {
		threshold = 0.42
	}
	return g.model.PredictWithThreshold(features, threshold)
}

func (g *GhostTextFilter) SetMinGap(gap float64) {
	g.minGap = gap
}

func (g *GhostTextFilter) SetMinPrefixLength(length int) {
	g.minPrefixLength = length
}

func (g *GhostTextFilter) SetIdleTimeout(timeout time.Duration) {
	g.idleTimeout = timeout
}

func isIdle(userBehavior *UserBehavior, now time.Time, idleTimeout time.Duration) bool {
	if userBehavior == nil {
		return false
	}
	lastTyped := userBehavior.GetLastTypedAt()
	if lastTyped.IsZero() {
		return false
	}
	return now.Sub(lastTyped) >= idleTimeout
}

func countTokens(text string) int {
	fields := strings.Fields(text)
	if len(fields) == 0 {
		return 0
	}
	return len(fields)
}

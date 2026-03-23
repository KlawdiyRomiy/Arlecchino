package brain

import (
	"math"
	"sort"
	"strings"

	"arlecchino/internal/predictive"
)

const scoreEpsilon = 1e-9

func stableSortSuggestions(suggestions []Suggestion) {
	sort.SliceStable(suggestions, func(i, j int) bool {
		return suggestionLess(suggestions[i], suggestions[j])
	})
}

func suggestionLess(a Suggestion, b Suggestion) bool {
	if math.Abs(a.Score-b.Score) > scoreEpsilon {
		return a.Score > b.Score
	}

	ar := sourceRank(a.Source)
	br := sourceRank(b.Source)
	if ar != br {
		return ar > br
	}

	am := matchTypeRank(a.MatchType())
	bm := matchTypeRank(b.MatchType())
	if am != bm {
		return am > bm
	}

	if a.Confidence != b.Confidence {
		return a.Confidence > b.Confidence
	}

	at := strings.ToLower(a.Text)
	bt := strings.ToLower(b.Text)
	if at != bt {
		return at < bt
	}

	ak := string(a.Kind)
	bk := string(b.Kind)
	if ak != bk {
		return ak < bk
	}

	ans := strings.ToLower(a.Namespace)
	bns := strings.ToLower(b.Namespace)
	if ans != bns {
		return ans < bns
	}

	if a.FilePath != b.FilePath {
		return a.FilePath < b.FilePath
	}
	if a.Line != b.Line {
		return a.Line < b.Line
	}

	return a.Text < b.Text
}

func matchTypeRank(t predictive.MatchType) int {
	switch t {
	case predictive.MatchExact:
		return 5
	case predictive.MatchPrefix:
		return 4
	case predictive.MatchWordBoundary:
		return 3
	case predictive.MatchSubsequence:
		return 2
	case predictive.MatchNone:
		return 0
	default:
		return 0
	}
}

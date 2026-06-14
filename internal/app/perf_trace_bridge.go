package app

const perfTraceFrontendEvent = "ide:perf:trace"

func (a *App) startFrontendPerfTraceBridge() {
	if a == nil {
		return
	}
	a.onEvent(perfTraceFrontendEvent, func(data ...interface{}) {
		if len(data) == 0 {
			return
		}
		a.logInfof("[PerfTrace][Frontend] %v", data[0])
	})
}

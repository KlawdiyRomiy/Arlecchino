package app

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestStartDeferredProjectWarmup_ReturnsBeforeTaskCompletes(t *testing.T) {
	a := &App{}
	a.projectCtx, a.projectCancel = context.WithCancel(context.Background())
	defer a.projectCancel()

	started := make(chan struct{})
	unblock := make(chan struct{}, 1)
	returned := make(chan struct{})
	var release sync.Once
	t.Cleanup(func() {
		release.Do(func() {
			unblock <- struct{}{}
		})
		a.wg.Wait()
	})

	go func() {
		a.startDeferredProjectWarmup(projectWarmupStep{
			name: "blocked",
			run: func(context.Context) error {
				close(started)
				<-unblock
				return nil
			},
		})
		close(returned)
	}()

	select {
	case <-returned:
	case <-time.After(50 * time.Millisecond):
		t.Fatal("startDeferredProjectWarmup blocked caller")
	}

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("deferred warmup task did not start")
	}

	release.Do(func() {
		unblock <- struct{}{}
	})
}

func TestStartDeferredProjectWarmup_StopsBeforeNextStepAfterCancel(t *testing.T) {
	a := &App{}
	a.projectCtx, a.projectCancel = context.WithCancel(context.Background())
	defer a.projectCancel()

	firstStarted := make(chan struct{})
	unblockFirst := make(chan struct{})
	secondRan := make(chan struct{}, 1)

	a.startDeferredProjectWarmup(
		projectWarmupStep{
			name: "first",
			run: func(context.Context) error {
				close(firstStarted)
				<-unblockFirst
				return nil
			},
		},
		projectWarmupStep{
			name: "second",
			run: func(context.Context) error {
				close(secondRan)
				return nil
			},
		},
	)

	select {
	case <-firstStarted:
	case <-time.After(time.Second):
		t.Fatal("first deferred warmup step did not start")
	}

	a.projectCancel()
	close(unblockFirst)
	a.wg.Wait()

	select {
	case <-secondRan:
		t.Fatal("deferred warmup ran a later step after cancel")
	default:
	}
}

func TestStartDeferredProjectWarmup_ContinuesAfterStepError(t *testing.T) {
	a := &App{}
	a.projectCtx, a.projectCancel = context.WithCancel(context.Background())
	defer a.projectCancel()

	secondRan := make(chan struct{}, 1)

	a.startDeferredProjectWarmup(
		projectWarmupStep{
			name: "fail",
			run: func(context.Context) error {
				return errors.New("boom")
			},
		},
		projectWarmupStep{
			name: "second",
			run: func(context.Context) error {
				close(secondRan)
				return nil
			},
		},
	)

	select {
	case <-secondRan:
	case <-time.After(time.Second):
		t.Fatal("deferred warmup stopped after a step error")
	}

	a.wg.Wait()
}

func TestStartDeferredProjectWarmup_WaitGroupDrainsAfterCancel(t *testing.T) {
	a := &App{}
	a.projectCtx, a.projectCancel = context.WithCancel(context.Background())

	a.startDeferredProjectWarmup(projectWarmupStep{
		name: "cancel-aware",
		run: func(ctx context.Context) error {
			<-ctx.Done()
			return nil
		},
	})

	done := make(chan struct{})
	go func() {
		a.projectCancel()
		a.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("waitgroup did not drain after cancel")
	}
}

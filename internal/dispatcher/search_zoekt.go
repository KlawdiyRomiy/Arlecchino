package dispatcher

import "errors"

var ErrZoektBackendUnavailable = errors.New("zoekt search backend is unavailable until dependency audit and tagged implementation are complete")

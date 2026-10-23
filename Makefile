# Production deploy helpers. All scripts live in the docs repo (docs/deploy); nothing here pushes or deploys
# unless `deploy` is run with YES=1 (and it still needs the owner's explicit approval).
APP_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
DOCS_ROOT ?= $(abspath $(APP_ROOT)/../docs)
DEPLOY := $(DOCS_ROOT)/deploy

.PHONY: release deploy-dry-run deploy deploy-status rollback

# Build the release bundle locally and print its file list (no network).
release:
	SPINDLE_SRC="$(APP_ROOT)" "$(DEPLOY)/prepare-release.sh" --list $(ARGS)

# Local rehearsal: bundle + deploy.sh --dry-run against a scratch directory (no ssh, nothing copied).
deploy-dry-run:
	SPINDLE_SRC="$(APP_ROOT)" "$(DEPLOY)/release.sh" $(ARGS)

# Real deploy to oko. Requires YES=1 and explicit owner approval; without it only the dry-run summary runs.
deploy:
	SPINDLE_SRC="$(APP_ROOT)" "$(DEPLOY)/release.sh" $(if $(YES),--yes) $(ARGS)

deploy-status:
	"$(DEPLOY)/release.sh" --status

rollback:
	"$(DEPLOY)/release.sh" --rollback $(if $(YES),--yes) $(ARGS)

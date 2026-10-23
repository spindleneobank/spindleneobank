# Run from anywhere: make -C node <target>
.PHONY: node-image node-image-vllm node-image-push
node-image:
	DOCKER="$(or $(DOCKER),docker)" sh scripts/build-images.sh

node-image-vllm:
	TARGET=vllm DOCKER="$(or $(DOCKER),docker)" sh scripts/build-images.sh

# Owner-gated: make -C node node-image-push IMAGE=<ns>/spindle-node PUSH=1
node-image-push:
	TARGET=all DOCKER="$(or $(DOCKER),docker)" sh scripts/build-images.sh

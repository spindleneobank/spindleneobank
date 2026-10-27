# Run from anywhere: make -C node <target>
.PHONY: node-image node-image-vllm node-dist
node-image:
	DOCKER="$(or $(DOCKER),docker)" sh scripts/build-images.sh

node-image-vllm:
	TARGET=vllm DOCKER="$(or $(DOCKER),docker)" sh scripts/build-images.sh

# The tester distribution (what the API serves): bun run node:dist
node-dist:
	cd .. && bun run node:dist

FROM scratch
COPY --chmod=0555 keel-proof-executor /executor
COPY --chmod=0555 keel-proof-runner /runner
COPY --chmod=0444 receipt.json /receipt.json
USER 1000:1000
ENTRYPOINT ["/runner"]

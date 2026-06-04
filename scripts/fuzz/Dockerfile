# Linux fuzz environment for SharpFuzz. Built/run on demand by `make fuzz`;
# never part of CI or a git hook. Keeps the AFL/SharpFuzz toolchain off the
# developer's (macOS) machine.
FROM mcr.microsoft.com/dotnet/sdk:8.0@sha256:fc69dc5e0c9789adaac5c8efce71ead4d016a51318667c4f26ce93574b1b9403

# AFL provides the fuzzing engine SharpFuzz's OutOfProcess runner drives.
RUN apt-get update \
    && apt-get install -y --no-install-recommends afl++ clang \
    && rm -rf /var/lib/apt/lists/*

# SharpFuzz CLI instruments the target assembly.
RUN dotnet tool install --global SharpFuzz.CommandLine
ENV PATH="${PATH}:/root/.dotnet/tools"

WORKDIR /src
ENTRYPOINT ["bash", "scripts/fuzz/run-fuzz.sh"]

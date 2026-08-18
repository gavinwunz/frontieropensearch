# Shell environment for building Frontier OpenSearch on this machine.
# Source before any mach command:  source agent/env.sh
#
# The root filesystem is small, so all build state lives on the data volume.
# ~/.mozbuild is a symlink to MOZBUILD_STATE_PATH as a belt-and-braces measure.
export MOZBUILD_STATE_PATH=/data/.mozbuild
export CARGO_HOME="$MOZBUILD_STATE_PATH/cargo"
export RUSTUP_HOME="$MOZBUILD_STATE_PATH/rustup"
export PATH="$MOZBUILD_STATE_PATH/cargo/bin:$PATH"

# sccache. The cache must live on the data volume: the default is under
# ~/.cache, and the root filesystem does not have room for it.
export SCCACHE_DIR="$MOZBUILD_STATE_PATH/sccache-cache"
export SCCACHE_CACHE_SIZE=40G

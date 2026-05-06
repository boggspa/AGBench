const { signAsync } = require('@electron/osx-sign')

exports.default = async function signWithResolvedIdentity(options) {
  await signAsync(options)
}

// SHOW ME MY RIVAL - build checker: the page must be self-contained, inside its size budget, and carry the credit.
// Usage: node tools/check.js [<file>]           check a built page (default: index.html in the repo root)
//        node tools/check.js --docs [<file>...] name lint only (exact credit, no maker phrases, no deny-listed name)
//                                               over docs (default: every tracked .md file, read from disk)
//        node tools/check.js --hash <token>     print the deny-list hash of a token (lowercased; words split by one space)
// Exit 1 on any failure. A WARN line (size over the warning line) does not fail.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SIZE_LIMIT = 700000;            // bytes: FAIL above this
const SIZE_WARN = 650000;             // bytes: WARN above this
const CREDIT = 'Developed by tangoSHELL \u00b7 2026';

function sha(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }
function norm(s) { return String(s).toLowerCase().trim().replace(/\s+/g, ' '); }

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
let fileArg = null;
let docsMode = false;
const fileArgs = [];
const hashArgs = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--hash') {
    if (i + 1 >= argv.length) { console.error('check: --hash needs a token'); process.exit(1); }
    hashArgs.push(argv[++i]);
  } else if (a === '--docs') docsMode = true;
  else if (a.indexOf('--') === 0) { console.error('check: unknown option ' + a + ' (usage: node tools/check.js [<file>] | --docs [<file>...] | --hash <token>)'); process.exit(1); }
  else fileArgs.push(a);
}
if (!docsMode) {
  if (fileArgs.length > 1) { console.error('check: one file at a time (got ' + fileArgs[0] + ' and ' + fileArgs[1] + ')'); process.exit(1); }
  if (fileArgs.length) fileArg = fileArgs[0];
}
if (hashArgs.length) {
  for (const t of hashArgs) console.log(sha(norm(t)));
  process.exit(0);
}

// ---------------------------------------------------------------- name lint lists
// Credits rule: the page names nobody but its developer. Proper-name tokens that must never appear (AI models and
// AI vendors, game engines, asset and art tools, game studios and publishers, code-hosting and chat products) are
// kept only as SHA-256 hashes of the lowercased token, or of two or three adjacent words joined by one space, so this
// list does not publish the names it bans. A multi-word name is listed twice: spaced and joined (no space). Add one
// with: node tools/check.js --hash "<token>" (and --hash "<words joined>" for a multi-word name)
const DENY = new Set([
  // AI models and AI vendors (75)
  '053ea4804ef1bb33d4a3d6fb024a614b6d257cebc2bc7cd915da9c9522f37ffc 06e88eae7ee0b406c300f8036e529f63be2b48fb1a44ac487737501d8734e648 0ac0192d441f96da3a4a3174330c3a74e034a3a4704fded0e87515d1a97c19dc',
  '160b93ba38ba1ecd658a83fe1d4023c4f7751a9315d80fc1a4816ac763102f93 17b070ee96c7efa9a26565bea5d5240e2cd2a30356f3988b9c2585ed172095e0 194cbf5c4433b278166f7eca3fbab6c639a862ea7dcb10250fdb7dc2c129693a',
  '19621d3b5ab0aac8fcea49ad37734204b75b692f4f7dbdea5a41fe4bf35d74dd 238f51b7c7c924fa3fe77ce7d0b214a05408df5b1ec84f9e614462017c42b005 2aba30a13c41e0266664eccdbc5bf7424608fe1c55efe827298e89464035a616',
  '2e3feb56f9c441250b92592cce139130cc0758070065b6369fe9ac11df927b6a 305587cba515b319fdf13937fc2d291875c6323a266e1d6417821a1120892794 336ab1deb42d6284648d32be43f4a51549615ba1533135abfed57b123c304f84',
  '3ea125d0bff386e6754b3782b300016fc79a9cf8f8669c0a5c3db64467ddb681 419833c75dd65fb3ac77e05c276bb477aa5586e754d2f90d583cfbf97642793e 47556a0c93b25b8aa2af2f022a7784e173a8dc49fa0f91a38a21f2dcc3620372',
  '4d3ec2b86c0f9e576151c0099547011add2056249696c0a944839782853eff18 4f364b00e3dbd2edb69176ca11e96d6e5340d532cf61e57a88688745fd10091b 4fb53885862e0f970d5063417cd343ab5f75c770897578ce0cf7b37cd04b5122',
  '51dd363eb74cd7675c219917e2ab05f43944c5e874553c450b0a7a4494850cfe 52c9308c83ad801bd4261357e17181b83064745e53e5fa248ecdf1e89c62032f 5309b5437e6c0c0c1316675cc898d6eddd982c5c71f7dc8f13911533270585f3',
  '53b69ef92c836777382b9551b7f44ec0ccbd1ebe0f643a15b3df206465e6adbc 586937124e151c46f21a2de1d49b6236c168a5d2902b3c8926c2c54a8b78a416 5ca0b910e19bfef264d52c484a1a6aa4f8a38969760c30b887b9854f57c12e4b',
  '5d72436256ada53828b51895a94bb8489e9f1ac4fe937a8024ef1594e7045ff6 60965168ce762e949600281ba6d01fee136e5b6e8257b1f216f9025ed324474c 663ff898aa8bfe1defe0666ebdd1bde187b7924eac7675caa4c0281b1bd30c51',
  '66c6f57f73358bfacd9b35d0abf55dcbb1fbd1a92f4dfcbe144e6046ea566f79 67f2d22514622d1be30c14ee9f3cb104503a159a33a656ca91a1953aa9616429 6a0adb4b6acf50826838f3853ddd0930d2048e7d8cea775d11fd7ee3c08362e3',
  '6b0c6e59dd77f7db336bd011f64991b0064ce6d5bbd9faecef0f9750d080f457 6ca85641227ebc3386fe2d215de0d3fb18579876f49018507f232f9be8da55f5 6f7ac1823da81d2e52d1a1549ee69c85bbf8bb56d06682849e7c09da2785ce3b',
  '6faef1df454754cb29df4e7e91bf6e37f64060ba852cb61d9f201f7b2a96b6bc 6fcba5d96a4fadfdd63064cf21da843c31de9a702bbee7fe306d4754fc9dd262 7064757061031fa629b1ebb2f369074ed8dcfd4d17a65a280abb27a8786d75f7',
  '7d3194f79e645c42e4396dda38be04766810ec6a00d00aced3ffc2a0a1f1a9ef 7f7e69d124b386b927f93b15570260ce0ad303f817ee97d8902b24536a35dc4d 88935407039ab8e18cf2f7bd1611c314e5187d99403ccb7c2d44dcded189c862',
  '90642c3dd333bc0e602c9fa887ab0f0482886d0ed52ce8762a27a5f901528fcc 920510199770f4d65cb8aaa2cd12bdb2b8c37f5b3907c50a734a0e3409da2823 938973a5d41077ec2deb8f4320e4f0206000a785d30d63cfda66723c67ed245a',
  '97e0ea1edc48790d5e6946be23d15e391a7c06eb2486404ec9581771759ec40a 97f128115e33c7693db6156c493d1fcbe0ebf4a870b6b49cd4b6b865233f7725 a282e0b70814f477de08fe0aa1218a7743e7beacd442f0f8068ceb66b8eff367',
  'a4c745facd3a921565e2c12d2db6a4021d4764f633a18400634d68df575ffb35 a89151ba4b5ac0f22e96b71b963db927791d3808f5175f06ae4a60de5891bf0f add92b9cde2bdbf3daaf65a0db79e9b1a7fa428b71b4d6ce38c742eb6dca0c1c',
  'ae31f30d39374a8b3194d89a1ad6aa56848547dc892bdd350605890d1d586fc1 b5d641b432cca81e57b5bb5b73c53e64c50d44dce93595a85d1d8885f48548e8 b92d5f7ac7e7202efa930939d87533a986755ae2f168a4772698b7c627468016',
  'c04bd5ebd10ab69665f88a6785f81c08783dafdae6af6a09544ad1fa00699480 c547687a37cc0ecabffbad2699540f419a47e0a86b77fd9c0140b88bb32bc80c c70eca6b0f88f44d81a41311647e50fda1ac454ec04ffd442b0eb4743a993131',
  'c7b75595683a3e118aabb84b2d74047574729670e97e9d5035d547c28b8b1489 c857d09db23e6822e3600bc06ad8d58f92ed62bc8efd81c753f77048662cb97d c97504235ab15009f6c5f11ba890007a5f3fdd20c9e57b53ea74855033572ddf',
  'ce63f29292acc06915e24d355f100d223d362b7cc913a7e1e620ffa5de33a76a ce94b59d958e0f6049c9a46571165d896eb14ec96da99c941c113d17d7bb533a ceaf6109c3cc4fea4dfda2b5ba0665b95cda7bc99efbf0b5c4e5826fce812bf0',
  'd203a277f19a8f7d78fe8e9a621534b2cbd8ef1f0d809908ffc481e778858872 d41c0af6c8278228e6912e310197059aca502a16987aa9c6901dc4ab5586224c d44dcb440c54129b50653187ae87c174ae1167dfe266df53d25aa3fd4273bc32',
  'd931372ba7f836a0bf8405601b0a293927ba20bf368f12b2cf3affc384c8a9da e3ce9cc5efa9354c42b30704bed3e17cfad9ba9968592ffaa06b41dc7256cf4c e408ee3d83092ec7f7418c8430df349d62d43b57195888fb7609daf4ff22b368',
  'e47b457d5f76ab05b9d30eca7d29be766dbdbc21f8839df48c55a8f4aa501f8c e4f9c522e1c89280e9561b825f4f24fe32b51ff82d61e5c2b1dfd0321c35a90b e5c38a7f9b51e7d5e3f921337ce1daf41a89dbb121ac0b29dc52b4e187fd82c2',
  'e853b4e183ed08708fa41b2f88448464fcfd3b5e1b60d5ab5be260189df707b0 ea198c98bbb82c6d3163194fac6132c3f41a95e1be9235cab986980f5ba04253 f3ed9ee201ce50b5961e91b689cad0460a7c48848f7954f6dc96be2d1e435816',
  'f7ac5fc321b6a92be04c1f608e2a5172747f85423c6dbf5edb74a16f8944db54 f857345b2b5c4e2b5fd1f48830fad90294998dc7e6b8239c32602f5466e9e180 fc5a1047f5919892fcdf8aa79ea5d6bb6531b5c176939ef0110906cb225941c1',
  // game engines (74)
  '006b3a91c6cb72f11d885f243b879acfa3e18991bc2157d971be100858f85bb4 010ddf3f587b214399e34798ddc4b74584c69dacfce46c65e32cc1ce22cf9c84 0247ea5c4be35125957b7bd711a7c2149361fb25e6b3f5d399c5b81b83edd88d',
  '09a1e10448b31ab870f848c6eb7fa2805304a4c5adb739c32d78b93cbc911b02 0e63539305c0620bb7d5d3b267046e2a05b58d999b555cccbd42d899ce94e3e9 12e91bd871de6f359cbbac5fded8a900920155aa6e0eea34f9d7000d983175ce',
  '1410eeafda5995b0ccff63cc21aef4e25f17ca5f516b70a004192eb6f48698c0 19dab99fc0fb7683f90a8701b435bc6023ecc9c6413a4a8bc442453a220f0984 2022844ef6e48897e6ca7989ebe12a51a827526bb16adbd1bd0832a11523bc28',
  '20c4d9690ede8c9c545a58b8d3b9c3ea8e4679cf0b528957452330db042475c2 2c201fc5a7bf751155012e45a0b99fffe1b32a852107f64d2c6c1dbd7a0fb5c6 2d2c310e181950f327d76aec85e87b2caef1f27b4f64a01f1830d427bc138629',
  '2dcaf1b331cdea81ef5c5783e74c057df80bf1615ad9615c65d2f43ab3fac5fe 30b60330d285f0b448cb3ec96811d0d0ecba810a2d76ac6512b2ad355ab8b0fe 33a82aa349e99371e369a7322ca64c9c675b8d90bdcaafb1d5e63e921b0450b6',
  '34c69f06c240e34b99fabe71e275d1cfd934b16596762abdac3f1306c49a7f01 3d0516b6e8f798eebe02eed316f94d28934183ed85a4ace632e1f734b2ed79a7 3db172ecf5fd1a4c649c44a49a5314ba61cb7e25cadfc79ef90f7311caf0b759',
  '3e98b224d8e9c02424b3178dc1f2674de132b5a03cd320016be2959a1dc7c75a 42eb5a736a972ef60d320bb6318d5fc1c193c53fdda610fda931b676f6fefa5a 452596f386a77da572934556cde47c2dedfa966438ec2208ae46d320a4d3a9e1',
  '46e38259f55225e7bdb631f1c14808ef6e9f1d3f1d6e79016152bd7b05121f2b 4f2c2e16d92de34151c3e7e649364d9f4a85d99a1663ed6ae35e115641759737 585bf6519ad269fbb4fcba309b2431e6e45119360e64ef4cf2de4017ddffe1b1',
  '5c004523cc98d6140c479f6b387a9d3fd91a7e02351b87924c0c4b0858ac780e 5e5c45d2968ebf330fa14d15ecb4df17a164c47caec8ecde7ce68fa055e19766 5f1e90e5bbf30fa0c0291e7d1e7bfd17a09ae64689ced1caae917d5fd428eabe',
  '5f73e94c6c864b7525a5a37f7dde214352d53d3356a9fc83374d52d20362e39e 62339083cc8cc19287a7207ec82f1766154c0512997082fdb4550e45abc11635 6cbbfac637a1806a84e9f05d82c4a1680096774562f45859c537abd1fe67fdd4',
  '70226bc4c63c523cbcdbb60b4fc3c1568b579ea32f3336a6a5fcacff9d8648d9 744531ed500fc7df90af968eb1f93b40b874bf2b59e453086aff8f6fd895dbb0 7b4db7b0c1f989be7b1859f6adf107c442e3497725297317af81cce1a22efeb7',
  '7e1e08b0780d90d3f7b015cce5f3e85228ae1488b9bcc60658f3011369d7b980 83ac660842325961b04031f18907efbd20a10df42b61b600f6ac2948815444d4 88bfb2a41863b46988738c1273c28cf47bc82985f244d6b1b71e54714e950f00',
  '8d5a48504fd5663ac30a34644ef04de0432ac2639e9436a2245a5698a65cb7a2 8ddf177ddc0cd389049439765267a56876b9c3700d9ac66d4e7c099482b775a7 8e4236b4b3652da4becae52cdb1cc1043f3eee940abf9fbe976b15a0d8e3fc40',
  '8f351f1f88d6255cd1aa2ef99ef8a5e723ea65597d52e2b935639f98a9b4c2c0 8ff0df576b62c7f791c17262822b8be6fe476b9c62223586c43f5bd70f58eaea 90f0a5ee800a5c29575a90fa219af378faab84db5ad5d22002bf24133061336f',
  '9133cef75d0f779f2625ecb2d0a9b385e3ff78def57018f05e22b9b4e37eb0e4 923fd29f32d6b097f126ca1a582b6ceb126ea9b741c2e98e21ec9ad04b2be36d 945b8b547db583736a569f3ce115642f07a497e5b7c7b687843f14bdaed805e6',
  'aa9bfc6a1553651ad449c2ac5f561ba72a8d3194017248f64783fef90b1d7fbc ab7b03328885d8e22815c069852351d46d60f533ea90650734772dfd93517000 acb7d01721086dd4a76f61bae525a565cbb2d62ea7480dd59da101c7fc6d3025',
  'b829205a9ed936c220bba10675f417ca17d44ef77c9333f78341e82b758aeb73 ba314a675ee7556dc74bab8d1a2d76934895072fe206f34591f0e420fa81c24c ba85051d97d6042db2bddf85a3a97e520406753942a0d87ba59c529202482fbc',
  'bbd0626f62bebf93d0c6813ea43c0e1ca55c35a6c7f8fc4249ba0120da0d673e c036cc748f98927ba719abcbe96c4527beb6daca4eb3650f764a7dd72c63e5f9 c269c204811383b07929cfc5dd2228ab65e991314d0f63d603212230b1c58da8',
  'c629695bba3cbb3a0fb0eab3a7746c72836fecb938073f483627bb144ebbfeb6 c7871257e4516b5887444f451c4d555814a3eba2c5b22844c34d589240b66614 c891068e9baf1b0dbc46495d6f0156d4179e508b62fd5caa5cd6b6b875f1c728',
  'c8eca56886a1869756a0bafe088da3426bdf55dfaf928ec8185d39316593f710 c8fa85e31cb2121197bba7b111f4310e8622cb9d637978fc609ddc0466512d8d cae51881feb8ec22eb1cbbb798113116982d07cb939116ddb6674a87ddf8a3cf',
  'd6c0f03aecce5738daa4f9eef66d55eb46a0a6d3e541c03cb91ebd02188d850d d9eb257f7dbec86f56f07e51ad0d607b07246a768d02a590bca6abd5bb5e3235 db25d5ab4e6a53defa33102ccef3b561ce5040d1b10cb11d056649dc695eecc3',
  'e745d36c29e6e1843427e3ea90b6844d81807f2f2e403099881e08351d08dd7e e76dd664135a6dbe91e9594d070d7317c3e7dda846d75455839143d52f077d28 ec2df8b0c57f10737da172992e3991293b07509b9a19674cbfbdaa478c8c82d9',
  'ee4001b00027e790101676bbe560350dbe7ebc91332612313e9e0b11cd0b8119 f1fa3d620a6278465cc907aa6e93381e52f1165e5b225423a06a2d791b09a216 f31f8acf5d10613c68b3a848c655a2991ff668d519e69f159fbfa49d85a53843',
  'f74d960b83ec72686e1165c55ac93e4864c8a3e67bf8253128362acc67f5dda6 f7bb4009826df60a1fc7895be8a79d7d30a235cf9edb2fede00f2dbaad0354fe f8c84d71945492e75c4514f23dea3c32151f9f6c1a55c0640ad47af1e6f8a252',
  'fac80608aee32093548c81e59ec3b1a4b167d789ee993c0ef9bc81bd992c29d5 fc52d68e8c423904a23c4b4d7323729433dba0b5216cf2ac53b40b3c2c97df41',
  // asset, art and audio tools (74)
  '007d2d575709512992e370d0279a4a579af38c872eead6acfd56967dd2964d46 02cf160481fa4407433c6f991fc1e85d55280615bc60efa22769af4cfe69c6e3 03d6489c3301659e3439e587f1f1eb5036ebebbedbd1973d64a0dca3baede23f',
  '05899c60c9f3e061cc01aef13773cf3247932c0836cabee4e502ee404001c07e 0871d655983efd5620973938d36077991c98b3363b03061449d6e8a5823472f9 09afc45f55ba89363e341d92bcc56cfab23a225aad584c97cc41af6b5b1bda94',
  '132bf05801220cf43265c3e3d4458d5419cb4305c1b5743c4e83e1b2254e57d4 157d00fe82fe45cd9aa1db235f9d39e9d3a77fc09c4e67ed5bf6b7bc6d0def16 1b04f37c7b52b906bdd29585ea5af3f1924897c0ed069e5ada741ac9c3d8416b',
  '227a49080dfa9006bc11bf68b92c55fca0db5dd57544f75e3638253c1dde9199 25dfe29075cca05729950c290c30136fbdf966aa8701dac7914f444577cf4e9f 2769cdab1cd69e1b54c9225a219216a32daabb34211f8c20b0dafaa092b4f021',
  '2ab53bf143f9741e888f92b13d9bf7b65f16c584780778297c8a48ffec70306d 2ae280b7b47499a3d8e51fa136c1b97f2f0533c5f5f95c49094a2a39b3fb891d 2ca29f1ffb3ce161c2926cabd30c545c6d4fcadb87c66f6093476e257dd10bb0',
  '2cbd4ab8d338251952a15aa1b476f0b0a5ddd356226600fa7f2897f9696a0e3b 2e7a178413991b7642554a3b52bc3ccdd4fee704a4719be6c7ff71d1ad3ef5b5 320d597682ed208cdaa58f77d17df6037e29f3c48323d6d16b23e0ca18f97788',
  '339d1a5ceace75b1e89e91d079265bb662e51a5871ef9272dce80ddc8e167ac1 35d18bc949282e32575c587f13835a8b26a7dde2b08f2d8d5da993fbe51ffc37 37d6a85005d1289f1af5dff4176e1a959378860519eb40588ea04a188f955190',
  '397d737b92dc3e7123be487f4ea1a1ed1ed341dc996c3a57a724644eac11a676 3db1f560db626918c55619d64ee4f32a0cdafd42eb319b641581edf619a2d36f 3f4a09b92ccf3382d71c8e3937b06b7945c6f1e42338d3f7e4c8577f220d810b',
  '3f7b3630f57e173f0efa60c54317ece168d887e23d2334691a4eec820bd00501 400e45812675c95965a0cf1ed1bfccb1d48f2a175796396a5c039cdb441041b2 4bb97ba42db6179049816c854699e3dc4ea94b938f2a181751551e2934e6baa9',
  '4ed0b79c527cd45c1e68eedea006482fe3102d8d75ea96501719bd3508d126bc 519545ade2133ac421cd6ca5bcca5efd61c44e591530ec7a381cfa8700b34ebf 5241ad7b64d854182ec532918fa6f911516a94452651cd0978e9c4ce032efa95',
  '541b7315ec4485bf14945330bb0fc85979a24dd66ec2e733dc5dfae7e40bd135 55fc240fe50c659211643f918c7340b7c69f777f4656116ceb81c2c6447cc1fc 599a75a70cc80234aee3cbd81d30aca75b41d9abbd95509b33b2c86140d4a150',
  '5a11086f16281c64afd0e78890eafcbafcae1f6b66a305faed103a36b1bdab7a 5b79d0d574eedd091c02692026ecfa1c617af2432c0a9b401e623e67d78a179c 5bb79960c841f78778f4fb45e4917cc3c32dd6b89f9f4b7a615f28f921728d31',
  '6211b5b61082400056a98fb174f3f3d59e5d09e37952fe7803ddf9c67c89e040 62f79d3a62560549784b7e0f8de4f0f8c3f4c7a8abe7b8432fdf75535e1fa6b3 64766e802b89b7005837b58bf406276d8c25c230d76d43550480caf01274d516',
  '69ff9427b2beb0d7277d14fa58f2a95190866a1c6cc2950e585521461aa33157 6a2a3673ae5601eb7e54d9db302959760277dda223d0faedcbfde0c427c87a01 756695e403b806d29ce3ad2fb42aaec10b5dc58b460e40dfefd346bbaa4c72a9',
  '76b2bf971431cc0694445b9e90d913425afcb008e3ab9150cbf84595740108c2 7845dbe9531670771d9c42cb2249a372611ed7ca5781e8004ebf06eaf526ee6e 79f50737930613a1fddb586bfa7a382393d5a7cf402f88e03c4534ed602d8822',
  '7a102e1bb9e7cae6dc2d817dd6a6dbe97850ebbb8ac0df03b0f8a5e6a938c04f 7c353b4c843c4619cfe1f0d0d67268cc73f8e4758fc61456e4e15fd77328dea4 7d28aafe728330ff918aaf2910c32060cf8722de1e4d44f238393289835d3006',
  '8541ad5581b61424ecf6c9c33762e36607ccc3a9ad194cd0a12948c25f341e0d 86cc3ab44d4e3c502acaf248af58f9bd4e9c42e93bd318c973d062041daf92cd 88d24a91462f8fad58fa5b613d074f7293afbdd27576311906de22838b1e65d2',
  '8ae667fa85ed593085924d19760780fb15db817372fc2f94833831c01b9ebe77 8faeaa7a3caf945ee16536b6c147d301bd882a4aeb4cb7bf485ac033ed045b51 8ff3bf3d452f053c6d7d6d5e1a9a0aa416eaaa2a7055d42d9b665368051fe700',
  '95f29be72fd4676f4a56831afaaa2a0fbae3aeb88c5185bb22a9df91f56ec07b 996820a504a17a9db9465ce4f4de6be1af11ea05c2713e2e2a1ce70030dc8627 aaf9f814e1198285d3a38d8c54991cac89674d1f9e8520a5e0515afc920c0057',
  'ae6660befc541a3233a76664f9b5e7ff5357be7f583f90db81d6eedf42ce0819 b07dce71118a4ccd5f587014a3f99d6e87cb6447137bd3f35a9cd05812d78cc5 b86657c179c6708c3c67890466e5c6e9bb982708e17489be710ab9bb91752fbe',
  'bbaf6e3c5dbf4e435315f10cc25c4ac63f1483b9a6218989892fb5ee052b7831 bc31050d72dc7334dd3e28d6ddd1143acf233338a37a9093273a82fba310a6f9 c8fb96bb2955e374cb5431e53053ecf0e0731b1ae9222d0f953cd5b026acb95a',
  'd004e3a0139c442de2f55e46796e106f7245ab9c61899e3f4798944eb9eb4666 d64c7298476f874f659deabcf622ece52e5d77bda5f0638461b432ec991aa28f d9c5c329b949b53cc34dad0bf696dcf8cfa7b1ebed7cd8449611f8bb10c2a6ac',
  'e414402c80e6e4ca0dfc46cb754671618c048d141fd134435ec87e896c5a2125 e87a0dd1f323dcb6600b596e370837b6a85a09fe8ea3b1d411321388040b227e ed4074dcc814597ccc9138bdda4279d90b9322927141287117ee380308e01612',
  'ee9021c84f33366bde80b75efa132836e47afa18b9ce58e8077f4c25d039666c f1c122dbb915680e7565ad483941b3cd1b5e9021ef5fc987faeaf23ccb0fe4a9 f51f13be9fa6b116eff8117c08a9036964b3e9fda919e0a262508f96bffcb674',
  'f6988cbe71f4b7bff3d0c01feadaf17790572be368fd6cfc709a234cf4ce89b8 fb72a2c607a6a371adcf997c9b6e9905b0db11b79051ce43b61d3b601ac89418',
  // game studios, publishers and stores (121)
  '02386f47844c3cbdb7fcdbd28f2cc442176cdcf5a75abc4efff0732d7fe9b2ab 02d62e3bbd186f3ada19ed237ff3107a64a4bf6c37799ad8a12ee1c851f0818a 063db909a17ec8c6fc243f999419bc7445c3e84da513e41727466f17476179c4',
  '1230d5a48c29b3a2af6beeed6eaf3f432ae8b7d9aab0a0cf1704ff5d86e76362 128326881733e148ccbd9eae9587ccb282a71d32d27bbe146115019288389d75 13c2be373f75d1da56dc7b30d5eb5d047a6ae4a964df1e3641e48bba99323233',
  '14e482f5912f19102f336abef27b965118669aa910f9d72560b8d6ff091ee1d7 1aa93c6bdf90127eac7074ee73470f9bc0b8817b7850361d1a7d36a33a2586c2 1e5142710fe66a0304c6544a53d2cc04d7464327d2d10694e27a155387c9d04c',
  '1e6cc35909a09a3660c76baebf1747891491a1cddb7776c859f4bea373023c5f 1ef925e5f04818db707159f9364e0aafe72fffb9dbfaebd33a0ca38c002be021 214f20414b947ffdcdac6962fe418fa277d3b54d1d469906dea283d538bce362',
  '21f9febe15805907ff9640c5dde532fdc47eb32ede3ccf4fc9f9b1dc479b565d 25ea08cb6a11974b204c64e725dde3d6d88ae35855eb2c42d0a439e937f116a9 265dc02d9b21833d263ef977b54c0920bd9fb1e0c72986201dba5499af32d57d',
  '26916a0725fd8000a372f677b87ea0651213b23f4f1f07dd4fe4429c83376406 275e598187b08c5c2aa12d754a1bc57fabacb9f4daf1e200a0d34d40bdff00a7 2accc70b351009226192dd30e568b41503d0f59edc0e3b319f79ff5b5383d59d',
  '2d66de1063106d4a5230e0574c64800f59bc07a54df43007d00f4b18dbd8a220 306ff8b247031f79835d33f36718ae825d0678de4e1c735d9d8f75d6078088fc 329b66f9c07e68aed07f398e924886aa8fc00846c7beed88b549bd572ee72c23',
  '33b87960247f42effbab829d86419879b3c4692bc7cb5cb30bd0489cd92ef404 349b355d783bca2d5dd46f14e468778416d7d963ced4247f899e1e4def9e5e66 3738f9baa6cd8012af244a9e364efd66d989aba9f697ea7f78ff28075b1f3888',
  '38aa257443a2ba06668f756033c785cc1e9c827ab15cbae63cfaf880579ad47d 4141c7db8a14cf868b6eb7ba27e45ce514740e259409055ac214cbe0c07605c0 4248a50f047c150a449ddcc8632e08a2e35ce5a2bd67021a3b138c79021d3509',
  '43292b701c17a497c462847b8b14013d6bd93f8759727f4f7574bd26433c7b58 447b4e0a9eca8d070f249fe47897c96ceb04088f66353a090274cf74682bd4ac 44c3a79dfc0fc3a2ff04567c7a0b5f73bb97f2ac77cacab221302c59477ff44c',
  '44cddc3f1be25271c8c2a824d85521ee8087db49c90efed6c5b884c995f4dd90 4be5725e1987245ab44ed941957396f4c6b01c68084672f15311bce2f08c0b31 4dcb13e802ca96588e700718c279aae13462659216fe8b5740fd919566177c57',
  '4e8789ae57c031e1e32437c2550ea8ce6eac75ed79aa3bc1c44b3970edbcbe21 4ebd3b8f03bad83eb41d338bbf340ba8042e8963b723d614ad139efac41557c2 4f925b25d11ad82b543dbb6717996582d46141742e93a04d6db23dc77dece45a',
  '501d5acb4acc06d85d1fe1979a5d36b68f2becc069756164f763fc8bd275d0f0 509fa5619e694e6ca215d8c461e57f703eabdfdad6def6dc656a4b477bd93e28 51ecbfdf2e47cc4908a1dbdaa6c262c575741f992aae0be3e3d266e4c86bc6a6',
  '538ece7e8db0b14fc1d6885295a29798f52f60cd225bcfa834cc912b63029185 554fac0b7b265fc7be100fb7ce50f1a9e449e94d6c4bc956698fafc5e7435244 579d45e0f5ca37c1a4f632549810d0cd18b65263476bb3821ed3a535625d7d89',
  '57c4414f6c19029b27a630df1fe552e96b8a7437acd58ccbd7cce64711326546 587d392b6c7680ec7656baf143511491e62c4ec6f459c21cce6953e6f1707bd7 59441739c86a464baf0ec86d50433d9348cf2ab3edcbbafe6d43a28c9dfe525f',
  '5ce0114b41507395fff8b794517e33e48786c24a38ed9e1eea8fdab2fd046e66 60e65994852d4fae8410492c50516f1b191ef100d2eb55ba91e89cd654c0189c 66215adb46ba20c01eb6aa31dcba8a296443ef21b3f5e3f42642910d2bdcaa00',
  '665168ae83ad009e60751f2d7bc6eea76775323fbbc66b4becde952c9a046eb3 66a8777abd6beef5a2aff162518e5a347dfa0eaf7b73124365b65778ba6176c4 66b16fa3b55eda6f5359b44ca95bbedcb5e7c1ccf6e4916b72b706654f6a6495',
  '6737da25fcaf92b8707cfbc702f217c5d4c0034eb75a68f16716439d50840a79 6a5ebc8254dd22f2d54faeddfeee2143a3f7facb2de5aa61a00bb9146f2cca78 706246dabd6a8c105e9701115d6590c068d59a214ddf7f63a75f28b5cb0e4baa',
  '7285f9b5d40be1d067836672f2173b6beb53d2635f91d2b4f3a1bd6af66124d5 73d5e0d127b996bbed46278f75b7f95f900d03f9995eddd74f1271f43a45a900 7626518e064a333ced98412bdf9aadbf42e333e0084fed078d16a3b4c0b5cffc',
  '762a37958e718a3407c3bad7f6feaa323bdb8d1f0445083ba0da6d5f81799813 7d08db66ce91c1aecc241c120d3e29bec41e63632d4252e2c0f52f74e8b25cb5 82b9e338c771d2925f8d41cf88b2cb5e63ecea75f74e396e60cc03f75644d0d0',
  '8511ccd94c5fca3882a3a88530c15d2ef9c43902095199f7b9024498440e5ef8 8914c6ae54be15472e0d09c0e109e19f9439b64ccc21f3fca1bf4f30c0c30cf0 8c0e29e35bcf96b17702427d07c7245366df3591978f7033ad009d84c3b9b4d3',
  '8f207c72f54fe5388e94391c6a32c7755d035a3856394974624e62ffbb776955 9009e36e05ce67656890ce57dbbe0af6e5702f852c27e462a82c807f923dd568 99806d9f094c09b15cb4ada681ea82a114697c1ad59b28ba7af75da2023f2c1f',
  '99da742cd4690153fa90429e4db7dea66e1ef08ded9166d9b4f9278136a8c8d5 9a265b567c8c176c25ef308556b1875b781388b41dc135038f949da4a519b885 9c00cdb06dfe63c1ad11562ea74fe1b6ee0b5333ca7e1d0fc4b1717000d2281d',
  '9c4910b0299a535509b538f7f895c567cee64ef31cd6ec0a3e19fbcfefc80d58 9c8ae69b84f21a2e46df9edf0063a697afec050188ff2884ddc8ab32b5e58c43 9ca71c9bebafb944739dc22c7f37eddae8e16174c97007ba716a70eaa368e302',
  '9efbd314911beb0eb5030c163b0340d62928df14619b0023baf9112ba69bea97 9fbf261b62c1d7c00db73afb81dd97fdf20b3442e36e338cb9359b856a03bdc8 a258ea5dca9b0070686b38bce75ca14fddb847b0ab2c3893c568d183be0a6d9d',
  'a25c6c372e51666673f2ac73bbe403085b51d688d4489b02abb99a0a79ee56ea a893cb9a7edec18e2946d3a6f12052a6eb87cca40f5122e7f628321fc27ef977 b7cba1926016b4eee57eeaeb5629ad5128e02bd7482df0e9dcbcd2629d84d67c',
  'b954aee0f1b9a35f266d2f1956977222f65037326585e519b787073ec6a271a9 b9dc2a516cbb24e235ab90515c705ea117c0732eff1c67ca124e8904c3259b9f ba995ef4f06ea5a7328c8b9e63f7b406fddd0f3b007896653b66c596c26fcf29',
  'baf44e79cf4bd99309983d6958ed5cd275d2994b661348fcd07b2cf426a1be10 be77c4675a1a0cfac8c0f2e7d7087224a8f654875d4284093087b844bfe8795c bf8edd9d4c65399c29ec3c61f7a4752088d352c1a797405f291d05225d54e4bf',
  'c0a4942143e872cd1ae29fc759e04526de2e909ac1732734d38550a29c2e2516 c0e687a2d1fc85ee043de90c4bfafc300f927d5ee5439bd195ab9be96cacfae8 c1eb8e913000a8eb4e47226e1d8a9626a57c662197d9c051e6cf255d9c0c944f',
  'c237e9eaf8221eba8d745f5f0863beb2d8c48455bcc450152c266eea5fc231f2 c29cc5759ba4970a1387c60c6d4ee68f61718d9fd3212f28f20143fb97e1d844 c691c4fc8e73776d1844d8b42491cc835b874389919981a5f8e273f7403ab458',
  'c6fbc2fc199c4e70c4946b783b95cfd84adc9e07db3bf7166a79841529464dbe cae94cae7302bf6f2bb190cd9380b56e167b64434a162d613cc0edcd0c8221a5 cc1a538356fa3008b82251fef3c3a3d9f55a3d1ae59486cf14b3e547b1ff8f8c',
  'cd2ebc90ea28bfd0b5cf33927407a65e64fa9be9f3936e3d38eabc5e7b482d89 cdaaca44289679b68f38981869b3a75f018e33eee2c1934393f9db62de209370 ce6722745f6a1945738fc095d91cc89979d9a9348d81b7fca371fb4a0c223a7a',
  'cf61c3427b3c3bb9db61c59a579c55f399d4bcf7cc3482295ad9f4ab763e90b5 d39455d707d7fb58c43ed34f596eef9f034b59ab6c3df1b15df994af9baeba79 d498ed00595c3275ec6fc6a5604f62eb97c30fc4c28a3b920334478f44cb884f',
  'd732fddafbcaf04bd16875007e92a046878edebe4a6277f5e990fa0c663de033 d818eb8447f10966fe1ee6f0c4517fe9edb9735bda4d217423305ccd05a02790 ddfa91f746dddc73e9b8a7ab06a77596e818e4888d06a83582e09eb8272fcd5c',
  'dec2b94a76139e2535669086dd0d4d26f7bdfba38ba137f166b8d6e8a7df002d decfc1d74ac05b2ae668ad9a2733edcd9befd9346da8ab52cfaedde00b25ea3b dffd9fb67acdcbb0fd085879eaa221f5e2c2c325e24e68e2edb4a6a61312e13d',
  'e087a3d95c0ba1f82d7cc4180541cdf83ba6f1fec62e26dabefea2cd8c78f036 e0daa73ee6eb211eb4dde13c4dee9dbf3f11c2b8238284533b7b3169af6962bc e8fcca0a0b80b19f127bf9757cdd779239ff57d53328fe500b0c7a244d9f0c1a',
  'e953803b3ae55691e82227f753c5293a2af636506de3827731963c8785d2f74c ecdf4e7621df4d1cf4e3731253124ce1fca8d7200e557f47c605afd2f91e82fd ee6527ed1bea9edc19fc3ac19b1eba1f098e58f515782663e1a72ccb0762caaa',
  'f081feadbc0c8d9c978c881f46f19f6e7f18d54fff5dc0fdb3a5a463cb2ae45c f092f24a3128ffd816f71bd08a0accf4a94d50e989038d24c6d2e0667cfcf1c0 f2423d071f26082d053141bad42a7cb050310a1c0dfc7be5e6333fa76d32328e',
  'f40a789dfb4086388d1a1bc44c847df26c517e19dd0408e5798a27da1668111d f4b96d74b2d0b7cc2c773d898edb8e91a08e28dcba238b183ab8a565fec70622 f711da60664c04c146d7a47b722c38a8d0bf46c3f52c2084c5c8d1cb78138e73',
  'fafee90e463885f6ae0d66d5fa818045723176f5e2858cb4f3afb325de5ffb0d feaadcc2f2254a820546b43b31cf6aef89e986004ad98bd416bff887f5d1b3b1 ff1a199925e407fa66d7b12bb36a68d12b990ad9b7f203f4690210027b938776',
  'ffc1a601ad585f25d53067e443f83f130818a534d4014329b3b58dcb9a0e18a8',
  // code-hosting, chat and social products (56)
  '0a7411a215b0fa5b760e96924a18de5945570de92a9a42262d207cef5abeefb9 0b304e6f04fc29801881f20c2aafe0736d29748fadae48248fe8ce9014d4f822 126cfbe1fd5413ba4d604c50a74bfc80471cec367b1604ade4d081f31c3f4f34',
  '12a4055b03fb99a6354e5f28eaf962d4ec549a3d0417b56c9a6398bf2c14b22c 1768c21fc46884dfc50dda89562fca6d9eff9d714c30db4a5575ce849632fb61 1e32847769dc4a1588004a1dfdf10041407a3494ae910bc76783917fffea7789',
  '238b8fa1861eab2a93d350e279a083893e64114f95b91d162aab3bb0179ac57d 24785c635228eb390eeee5c34515b392c80eaa4d66180e2982919f5c934e2572 24e6654bfd1ab85bebb1f721a4be46e6fdb9ea8974d14442d3aaecd1f971fcbb',
  '261ecd93ef8d7910159c6ddb137cc27cd12b4365db3100364694f2626ec55ab3 2a8b2a24701d4bad4cdbc1447b368bb53490f2b39d83fda46dddc17ec0184815 2da6105e7c5de7f46c7cd170a1c0b938bd00d91f2ebac814c20823ba7109c4c9',
  '2e183f2a7a70de1c10044f4e370a221a792736cb074835afcde6a9df457d413b 3a30207f810ec7f21238a97dda46f3bf3ab433ec690c21fe5ad9f4bc48c01364 3d59f7548e1af2151b64135003ce63c0a484c26b9b8b166a7b1c1805ec34b00a',
  '42f4c1b243334ddbddbcc44b0271967461f3a59d2ef37b68006ff54011946092 490414ac86e4c55e14cef6327f283f8cfd68dfb38e5c849214e32115e1170808 4d2a25bf3a231cb5ed15c70c179d5bf55cfddf3ba019720d8a33add0544fd738',
  '5077841ff0064e122b403b261d0eacb077145b56beab5baab7035a098ceccf75 5159417c344343e91124e2586c96f3be944afc6b93344684dfe2c252416ffa33 53eeb947e8786f6e47309928c96d30bfd434faa48052b86a01fb80c69847a258',
  '576ba7c2e4abb7184ca409154dbbbd5306c1a80747fbce4148ea6271fd21e776 58465a6f6cb16f2719b55ba9e3a15b3864f2ec9d49c83fe6ec67579904cd798f 58db89fcabf0d738116e418030abfefb7e6f66ba17c0d44b238fa4d9d6410c41',
  '5a94b096cd49d67eac8d964f7080587f7332f3d51fcc91aed2b24935f870f449 5beeafeac2e27eae5d4ba62590257718673461b2af52383ef7e3a53c7df14306 5ede56738376a8c53a7c99bf275b077a5c10df780a20cf3d8282fd59a2a9fb56',
  '64d11b5436a242d2e2f1df5e60b221bb9145d56a5a3be935a8ec2a1e79f0b489 68961e958f44649805b055bf271814f4aea082e9b64a8818c2cf0858d1b88058 6ccce4863b70f258d691f59609d31b4502e1ba5199942d3bc5d35d17a4ce771d',
  '6d459209b36e2895ae99c62af4eb9eef3cfdddb55d8f862a3418e904ce9ff3f2 7352f353c460e74c7ae226952d04f8aa307b12329c5512ec8cb6f1a0f8f9b2cb 7b8208d11b1b6f48e946e6361e527ab62af48b3090e7603a3bb5ede7045e5af7',
  '84308bea454057aa509a12fbd5212988973d7cd513bc555a24a06dd2cc72e39e 888a96cca96b1c5434e6c8add5852b918109c63c17fbb242ba23df0b9c9ce6e6 8af1c364b2b4005b168ea5121f4cf12f4942a49d938fd45b958355f8395f9555',
  '96970ac91a42a560263a22a7318e2c0b09993fdae470c28a0b4e4d092589cee6 9cbcc379b1c32d822d67735edb47f392fd8fd38716306e346308c76e2a295092 9d3508a8484ee2520ca5fe0e52eab835774efa3fe533267e914eb00ad78d2579',
  '9d96d9d5b1addd7e7e6119a23b1e5b5f68545312bfecb21d1cdc6af22b8628b8 ab7a428375435ad7c07e13349ce5c686e07354a4e019c8f2f685f4a5af3f5fe9 af817bdcee2eb7e8b769c92bba46bc95281dfbd777204e6446b851079edf95b7',
  'b3f0f2fcaa76939f28a2b9b94795fc76ab3f24a1cbe497b0e6f669adbbea1f14 bdf0fc939a65657b9574068e166ea01a3abfca774396a789652a3182be87e439 bf11eb52df8cda625a4741efc4f44fea86800482e115348ada457b45dc6b867b',
  'bf52bdd99a300da0ce366048970f10993af9f3a319a10495fed9523183f9c366 c0b0109d9439de57fe3cf03abeccbc52f4c98170c732d3b69af5e6395ace574e c94ab54729f12b21751c0bfd36aba97630422a6ac0ecb79f93b3747231b45120',
  'da1485ed3363abfccaccf9aaa0f9f0bcc7c4f7ba9ddf17330e1627e89a92ce37 dafb9847fdbf98ed97d07e73c27c38fb0c63107e80adce0014612e698c5c7645 db1dd4484881aa625657ca9647aca763050b9113d6cf5ff004bf4519c026f569',
  'e24a3ad0c819c116b1cfea629d52fe700927a343b07461a54cd28bdf6a32a70d e6f7f04f5a43e53f4df979478918ca1c962f1b93b9b5cce6690290d1748780ff ec5df277195755d82b8cbc3dedb4088ece38cece2ce935990373ef4dc4d83550',
  'ec8202b6f9fb16f9e26b66367afa4e037752f3c09a18cefab426165e06a424b1 f873a5218c8cd40af9932cadbe2f9ac25ff0cda9932fabcf5f9dc5819adcfcf0'
].join(' ').split(' ').filter(Boolean));
// Platform identifiers the page legitimately contains (the vendor CSS prefix and its audio-context fallback, browser and
// OS names in comments, two monospace font names, a CSS property word, the runtime the tools run on). They are skipped
// before hashing, and their camelCase parts are skipped with them. Hashed too, for the same reason.
const ALLOW = new Set([
  '03582eaa4cae2d477422ebbda77dff93d2529495afe2ccea4464b4220c28b5ce 46a4eebd20d881ecfc0ecb54f6d8346524fadb143726d256b1a045303fc67717 48ee046028069a9c6ded9844911eab9020389ac067e2a8772244b99be182e063',
  '545ea538461003efdc8c81c244531b003f6f26cfccf6c0073b3239fdedf49446 7208f7bdc4becfe2d7b290029e8023d860f9a7a44c1bb07fd994dc94bde8f52c 79941e86ee521fe0633492b135d0f6ec99971d95023a6c82220f5be220a81e0c',
  '9390ef32addf32bfdea786bc1e20679592498068bcbfcd357ea10ab64ea35e47 d8e60ebbbb2b1a9d5f0dd2cfc7e810688583ad8afb626fcc6c357f756e799530 f9cde2d96a1dfea48b996abc876b672f8c3e40650de46184b705ad56b814ee2c'
].join(' ').split(' ').filter(Boolean));
// Allowed in docs only, never in the page: the code host the game is served from, which the deploy instructions and
// the live address have to name. It stays in DENY, so the page itself still may not name it.
const DOCS_ALLOW = new Set(['c0b0109d9439de57fe3cf03abeccbc52f4c98170c732d3b69af5e6395ace574e']);

// ---------------------------------------------------------------- one file
// docs: the name lint only (credit lines, maker phrases, deny-list with DOCS_ALLOW); the page checks are skipped.
function checkFile(file, shown, docs) {
  const base = path.basename(file);
  const bytes = fs.statSync(file).size;
  const html = fs.readFileSync(file, 'utf8');
  const lower = html.toLowerCase();
  const fails = [];
  const warns = [];

  // Line starts, for where().
  const lineStart = [0];
  for (let i = 0; i < html.length; i++) if (html.charCodeAt(i) === 10) lineStart.push(i + 1);
  function lineOf(idx) { let lo = 0, hi = lineStart.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStart[mid] <= idx) lo = mid; else hi = mid - 1; } return lo + 1; }
  // Which source file does an offset come from? build.js writes its header comment, then src/shell.html with the
  // bundle in place of its marker; every bundled file starts with a "// ---- path ----" line.
  const firstMark = html.indexOf('// ---- ');
  const lastMark = html.lastIndexOf('// ---- ');
  const bundleEnd = lastMark >= 0 ? lower.indexOf('</script>', lastMark) : -1;
  const headEnd = /^\s*<!--/.test(html) ? html.indexOf('-->') + 3 : 0;
  function srcOf(idx) {
    if (idx < headEnd) return 'tools/build.js header';
    if (firstMark < 0 || idx < firstMark || (bundleEnd >= 0 && idx >= bundleEnd)) return 'src/shell.html';
    const mk = html.lastIndexOf('// ---- ', idx);
    const m = /^\/\/ ---- (\S+) ----/.exec(html.slice(mk, mk + 200));
    return m ? 'src/' + m[1] : null;
  }
  function where(idx) {
    const line = lineOf(idx);
    const src = docs ? null : srcOf(idx);
    const ls = lineStart[line - 1];
    let le = html.indexOf('\n', idx); if (le < 0) le = html.length;
    const text = html.slice(ls, le).trim();
    return 'line ' + line + (src ? ' [' + src + ']' : '') + ': ' + (text.length > 90 ? text.slice(0, 90) + '...' : text);
  }

  let m;
  if (!docs) {
    // ---------------------------------------------------------------- no external requests
    // Plain substring bans (case-insensitive): nothing that could make, or look like, an external request.
    const banned = ['http://', 'https://', 'fetch(', 'xmlhttprequest', 'import(', '<img', '<script src', '@import', 'url(',
      // other ways to reach the network or pull in a second file
      'new image(', 'sendbeacon', 'websocket', 'eventsource', 'importscripts', 'serviceworker', 'new worker(', 'sharedworker', '@font-face',
      '<iframe', '<audio', '<video', '<source', '<object', '<embed', '<frame', 'srcset', 'window.open', 'location.href', 'location.assign', 'location.replace',
      'indexeddb', 'document.cookie', 'ws://', 'wss://'];
    for (const needle of banned) {
      let i = -1, n = 0;
      while ((i = lower.indexOf(needle, i + 1)) >= 0) {
        if (n++ < 5) fails.push('forbidden "' + needle + '" at ' + where(i));
      }
      if (n > 5) fails.push('...and ' + (n - 5) + ' more "' + needle + '"');
    }
    // Script-made requests: a script element, a src attribute set from code, a peer connection.
    const reBans = [
      [/createElement\s*\(\s*(['"`])script\1\s*\)/gi, "createElement('script')"],
      [/setAttribute\s*\(\s*(['"`])src\1/gi, "setAttribute('src')"],
      [/RTCPeerConnection/gi, 'RTCPeerConnection']
    ];
    for (const [re, label] of reBans) {
      let r, n = 0;
      while ((r = re.exec(html))) { if (n++ < 5) fails.push('forbidden ' + label + ' at ' + where(r.index)); }
      if (n > 5) fails.push('...and ' + (n - 5) + ' more ' + label);
    }

    // Protocol-relative URLs ("//host.tld/...") in a string or a CSS/HTML attribute.
    const relRe = /["'(=]\/\/[a-z0-9-]+(\.[a-z0-9-]+)+[\/"')]/gi;
    let rm;
    while ((rm = relRe.exec(html))) fails.push('protocol-relative URL at ' + where(rm.index));
    // .src / .href assignments from script (an Image, a script tag or a stylesheet would load something).
    const srcRe = /\.(src|href)\s*=[^=]/g;
    while ((rm = srcRe.exec(html))) fails.push('assignment to .' + rm[1] + ' at ' + where(rm.index));

    // <link> is only allowed as the empty-favicon stub: href="data:,"
    const linkRe = /<link\b[^>]*>/gi;
    while ((m = linkRe.exec(html))) {
      const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[0]);
      const v = href ? (href[1] !== undefined ? href[1] : href[2] !== undefined ? href[2] : href[3]) : null;
      if (v !== 'data:,') fails.push('<link> with href other than "data:," at ' + where(m.index));
    }

    // ---------------------------------------------------------------- required content
    if (!/<title>SHOW ME MY RIVAL<\/title>/.test(html)) fails.push('missing <title>SHOW ME MY RIVAL</title>');
    if (!/<meta\s+name="author"\s+content="tangoSHELL"\s*\/?>/.test(html)) fails.push('missing <meta name="author" content="tangoSHELL">');
    const head = /^\s*<!--([\s\S]*?)-->/.exec(html);
    if (!head) fails.push('file does not start with an HTML header comment');
    else {
      if (head[1].indexOf('SHOW ME MY RIVAL') < 0) fails.push('header comment lacks "SHOW ME MY RIVAL"');
      if (head[1].indexOf(CREDIT) < 0) fails.push('header comment lacks "' + CREDIT + '"');
    }
    if (html.indexOf('/*__CODE__*/') >= 0) fails.push('unreplaced /*__CODE__*/ marker');
    if ((lower.match(/<\/script>/g) || []).length !== (lower.match(/<script\b/g) || []).length) fails.push('unbalanced <script> tags (a "</script>" leaked into the code?)');
  }

  // ---------------------------------------------------------------- credit lint
  // (a) Every "Developed by" (found in any case, the two words split by any run of whitespace, a no-break space or its
  //     entity or escape) must itself read exactly "Developed by" and be followed by exactly " tangoSHELL", a space, the
  //     middle dot (the character itself, a JS escape or an HTML entity), " 2026", then a character that is not a letter
  //     or digit, or the end.
  const devRe = /developed(?:\s|&nbsp;|&#160;|&#xa0;|\\u00a0|\\xa0|\\u0020|\\x20|\\n|\\r|\\t)+by(?![A-Za-z0-9])/gi;
  const CREDIT_TAIL = /^ tangoSHELL (?:\u00b7|\\u00[bB]7|\\x[bB]7|&middot;|&#183;|&#x[bB]7;) 2026(?![A-Za-z0-9])/;
  let dm, devN = 0;
  while ((dm = devRe.exec(html))) {
    devN++;
    if (dm[0] !== 'Developed by' || !CREDIT_TAIL.test(html.slice(dm.index + dm[0].length, dm.index + dm[0].length + 40))) {
      fails.push('credit must read exactly "' + CREDIT + '" at ' + where(dm.index));
    }
  }
  if (!devN && !docs) fails.push('no "' + CREDIT + '" anywhere');
  // (b) No tool or maker credit phrases.
  const phraseRe = /\b(?:generated|powered)\s+by\b|\b(?:made|built)\s+with\b/gi;
  while ((m = phraseRe.exec(html))) fails.push('forbidden phrase "' + m[0] + '" at ' + where(m.index));
  // (c) Hashed proper-name deny-list over word tokens (letters and digits; a token without a letter only joins runs),
  //     their camelCase and letter/digit parts (a name with a version number glued on), runs of two or three parts of
  //     one token (spaced and joined), and runs of two or three adjacent tokens (spaced only: joining separate words
  //     of prose would invent compounds), taken both whole and at the part boundary ("Two Words2" -> "two words").
  //     A multi-word name is listed both spaced and joined, so "two words", "TwoWords" and "twowords" all match it.
  for (const h of ALLOW) if (DENY.has(h)) fails.push('internal: hash ' + h.slice(0, 12) + ' is in both the deny-list and the allowlist');
  const hcache = new Map();
  function hashOf(s) { let v = hcache.get(s); if (v === undefined) { v = sha(s); hcache.set(s, v); } return v; }
  function isAllowed(s) { const h = hashOf(s); return ALLOW.has(h) || (docs && DOCS_ALLOW.has(h)); }
  function camelParts(tok) { return tok.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])/).filter(Boolean); }
  // The runs of consecutive words that end with the last one: a pair and a triple, spaced (and joined when asked).
  function pushRunsEnding(cands, words, joined) {
    const n = words.length;
    if (n >= 2) { cands.add(words[n - 2] + ' ' + words[n - 1]); if (joined) cands.add(words[n - 2] + words[n - 1]); }
    if (n >= 3) { cands.add(words[n - 3] + ' ' + words[n - 2] + ' ' + words[n - 1]); if (joined) cands.add(words[n - 3] + words[n - 2] + words[n - 1]); }
  }
  const denyHits = new Map();
  {
    const tokRe = /[A-Za-z0-9]+/g;
    let t, run = [], prevEnd = -1;                      // run: the last two adjacent tokens (none allowlisted), {full, last}
    while ((t = tokRe.exec(html))) {
      const tok = t[0], low = tok.toLowerCase();
      const allowed = isAllowed(low);
      if (!/^[\s._'-]{1,3}$/.test(html.slice(prevEnd, t.index))) run = [];
      const parts = camelParts(tok).map(s => s.toLowerCase());
      if (!allowed) {
        const cands = new Set();                        // a Set: one hit per name per token
        if (/[a-z]/.test(low)) cands.add(low);
        if (parts.length > 1) {
          for (let i = 0; i < parts.length; i++) {
            if (/^[a-z]/.test(parts[i]) && !isAllowed(parts[i])) cands.add(parts[i]);
            pushRunsEnding(cands, parts.slice(0, i + 1), true);
          }
        }
        pushRunsEnding(cands, run.map(r => r.full).concat([low]), false);
        if (parts.length > 1 || run.some(r => r.last !== r.full)) {
          const at = run.map(r => r.full);
          if (at.length) at[at.length - 1] = run[run.length - 1].last;
          if (at.length > 1) at[0] = run[0].last;
          pushRunsEnding(cands, at.concat([parts[0]]), false);
        }
        for (const c of cands) {
          const h = hashOf(c);
          if (DENY.has(h)) {
            const list = denyHits.get(h) || [];
            if (list.length < 5) list.push(t.index);
            list.n = (list.n || 0) + 1;
            denyHits.set(h, list);
          }
        }
      }
      run = allowed ? [] : run.concat([{ full: low, last: parts[parts.length - 1] }]).slice(-2);
      prevEnd = t.index + tok.length;
    }
  }
  for (const [h, list] of denyHits) {
    for (const idx of list) fails.push('deny-listed name (hash ' + h.slice(0, 12) + ') at ' + where(idx));
    if (list.n > list.length) fails.push('...and ' + (list.n - list.length) + ' more of hash ' + h.slice(0, 12));
  }

  // ---------------------------------------------------------------- size
  if (!docs && bytes > SIZE_LIMIT) fails.push(base + ' is ' + bytes + ' bytes, over the 700,000-byte limit');
  else if (!docs && bytes > SIZE_WARN) warns.push(base + ' is ' + bytes + ' bytes, over the 650,000-byte warning line (the limit is 700,000)');
  return { base: base, bytes: bytes, lines: lineStart.length, fails: fails, warns: warns };
}

// ---------------------------------------------------------------- run
if (docsMode) {
  let docs = fileArgs;
  if (!docs.length) {
    // Tracked .md files; outside a git checkout (the gate's HEAD export holds tracked files only) walk the tree.
    const root = path.resolve(__dirname, '..');
    const inRepo = fs.existsSync(path.join(root, '.git'));
    const ls = inRepo ? require('child_process').spawnSync('git', ['ls-files', '-z', '--', '*.md'], { cwd: root, encoding: 'utf8', windowsHide: true }) : null;
    if (ls && ls.status === 0) docs = ls.stdout.split('\0').filter(Boolean).map(f => path.resolve(root, f));
    else if (inRepo) { console.error('check: git ls-files failed; name the files instead'); process.exit(1); }
    else {
      // Dot-folders (tool and editor settings), dependencies and the git-ignored output folders hold no docs.
      const skip = new Set(['node_modules', path.join('tools', 'out'), path.join('tools', 'playtest', 'profiles')]);
      (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))) {
          const full = path.join(dir, e.name), rel = path.relative(root, full);
          if (e.isDirectory()) { if (e.name[0] !== '.' && !skip.has(rel)) walk(full); }
          else if (e.isFile() && /\.md$/i.test(e.name)) docs.push(full);
        }
      })(root);
    }
    if (!docs.length) { console.error('check: no .md files found under ' + root); process.exit(1); }
  }
  let bad = 0;
  for (const d of docs) {
    const f = path.resolve(d);
    const sh = path.relative(process.cwd(), f) || d;
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { console.error('check: ' + sh + ' not found'); process.exit(1); }
    const r = checkFile(f, sh, true);
    if (r.fails.length) {
      bad++;
      console.error('CHECK FAILED ' + sh + ' (' + r.fails.length + '):');
      for (const x of r.fails) console.error('  - ' + x);
    }
  }
  if (bad) process.exit(1);
  console.log('check OK: ' + docs.length + ' doc' + (docs.length === 1 ? '' : 's') + ' carry only the exact credit and name nothing deny-listed');
  process.exit(0);
}
const file = fileArg !== null ? path.resolve(fileArg) : path.resolve(__dirname, '..', 'index.html');
const shown = fileArg !== null ? (path.relative(process.cwd(), file) || fileArg) : 'index.html';
if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
  console.error('check: ' + shown + ' not found' + (fileArg === null ? ' (run node tools/build.js first)' : ''));
  process.exit(1);
}
const { base, bytes, lines, fails, warns } = checkFile(file, shown, false);
console.log(base + ': ' + (bytes / 1024).toFixed(1) + ' KB (' + bytes + ' bytes), ' + lines + ' lines');
for (const w of warns) console.log('WARN ' + w);
if (fails.length) {
  console.error('CHECK FAILED (' + fails.length + '):');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('check OK: ' + base + ' makes no external requests, fits the size budget and carries the credit');

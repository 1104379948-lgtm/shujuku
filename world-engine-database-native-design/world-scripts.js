export const WORLD_SCRIPT_PACKAGE_FORMAT = 'acu_user_script_v1';

const now = 1;

function script({ name, description, source, bindings, order, defaultVariableInput = {}, libraryNames = [] }) {
  return {
    name,
    description,
    enabled: true,
    language: 'javascript',
    source,
    libraryNames,
    scope: { type: 'global' },
    bindings,
    defaultVariableInput,
    timeoutSeconds: 60,
    order,
    createdAt: now,
    updatedAt: now,
  };
}

function library({ name, description, source }) {
  return {
    name,
    description,
    enabled: true,
    version: 1,
    language: 'javascript',
    source,
    createdAt: now,
    updatedAt: now,
  };
}

function binding(hook, order, config = {}) {
  return {
    hook,
    enabled: true,
    order,
    config,
    failurePolicy: 'continue',
  };
}


const WORLD_ENGINE_MIGRATED_RULES = {
  "world": "<world_engine>\n世界是活的。不在{{user}}视线内的人也在过自己的生活。\n\n一、核心原则（世界非中心化）\n本世界是一个独立运转的生态系统，{{user}}只是其中的一个参与者，而非世界的中心。\n- NPC有自己的生活目标、日程、社交圈和情感，不会无缘无故围绕{{user}}转。\n- 事件链、风声、团体进度等即使与{{user}}无关，也会自动推进。\n- 持续中的天下大势是每轮推演都必须考虑的世界级约束。\n- AI在生成剧情时，应优先考虑世界的独立运转（后台推演），其次才是{{user}}的参与和感知。\n- {{user}}可以通过面板看到世界的全貌（玩家全知），但主角本人只能感知到与他相关或他恰好遇到的部分。\n- 禁止默认\"所有事情都与{{user}}有关\"。与{{user}}无关的事件是世界的常态，不是例外。\n\n二、感知覆盖\n- 直接接触层：{{user}}当前所在空间、目光所及、正在对话的人。\n- 近距离层：同一建筑/社区/组织的其他区域，日常经过的地方。\n- 远距离层：整个城市/区域/组织体系，间接影响{{user}}的人和事。\n每次输出正文时，直接接触层写进正文，近距离层和远距离层写在面板中。\n远距离层的事件主要通过风声和事件链爆发来影响直接接触层，除非{{user}}拥有特殊通讯手段。\n\n三、轮次推进\n每次输出代表一轮对话。每轮对话，后台世界自动向前推进一步（与剧情内具体时长无关）。\n- 未在场人物按自己的日程执行活动。\n- 事件链按骰子系统驱动进度（详见模块二：事件链）。\n- 风声通过合法传播节点扩散；公告和消息通常保持稳定，流言可能夸张或扭曲，舆情可能随新信息转向。\n- 团体进度、凝聚力、经济状况等自然波动。\n轮次推进的结果必须在面板的世界摘要中体现。\n\n四、地域与势力具名\n涉及地理位置或势力范围时，必须使用具体名称，不得用\"全城\"\"全国\"\"某势力\"等模糊词。\n- 若世界观已预设城市/国家/势力名，则沿用（如\"帝都长安\"、\"北境王国\"）。\n- 若未预设，AI应自行创造合理名称并保持前后一致，且符合世界背景。\n- 风声的传播范围、事件链的影响区域、远距离层的描述均须遵守此规则。\n\n五、时间与季节（可选）\nAI可根据剧情自然推断季节，在面板世界摘要或经济摘要中体现季节影响（春耕复苏/夏炎户外少/秋收降价/冬寒燃料涨等）。事件须匹配当前季节与地区氛围。\n</world_engine>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。",
  "events": "<event_chain>\n\n一、双类型事件链\n\n事件链分为两类：冲突型（conflict）与推进型（progress）。事件 event_type 一旦确定不得改动；同名事件后续更新必须沿用原 event_type。若需要从研发引发冲突，或从冲突引出善后工程，应新建另一条事件链，并在影响链中记录两者的传导关系。\n\n1. 冲突型（conflict）— 用于报复、通缉、派系摩擦、追杀、战争、清算等会滚向爆发的矛盾链。\n正常推进顺序固定为：萌芽 → 发酵 → 逼近 → 已爆发。\n  - 萌芽：冲突刚出现苗头，只有少数人察觉，尚未形成公开压力。\n  - 发酵：矛盾开始扩散，组织、人手、传闻或报复动机正在聚集。\n  - 逼近：冲突即将落到具体行动或直接影响，已经接近爆发点。\n  - 已爆发：冲突结果落地，追杀、通缉、械斗、封锁、清算等已经发生。\n  - 已消散：冲突失去动机、执行者、资源、目标或时效，已经确定不会继续爆发。不是正常推进阶段，只能由AI根据明确因果直接判定。\n冲突型 level 表示冲突烈度和失控势能，Lv 越高越容易推进。\n\n2. 推进型（progress）— 用于研发、建设、训练、调查、派人办事、商路开辟、资源筹措、制度改革等会滚向完成的事务链。\n正常推进顺序固定为：筹备 → 执行 → 关键 → 已完成。\n  - 筹备：资源、人手、材料、情报、路线或计划正在准备，尚未全面展开。\n  - 执行：事项已经实际开始，有持续投入、行动痕迹和阶段性消耗。\n  - 关键：接近结果，最容易被干扰、截胡、反转、延期或付出代价。\n  - 已完成：成果落地并进入世界状态，可能生成后续事件、风声、经济或势力变化。\n  - 已失败：事项因执行者退出、资源耗尽、关键条件永久丧失、被有效反制或时效过期而确定无法完成。不是正常推进阶段，只能由AI根据明确因果直接判定。\n推进型 level 表示完成难度与影响规模，Lv 越高越难推进。\n\n二、推进机制（本地骰子 + API 双重驱动）\n\n每条事件链使用 progress: 0-100 表示阶段内进度，达到阶段阈值时晋级到下一阶段。\n- 本地系统每轮先掷骰给出一个基线推进（正常推进、受挫倒退或保持），并负责终局晋级（已爆发/已完成）。调用本规则时，传入的 stage 与 progress 已经是本轮骰子推进后的值，本地机制会在状态中体现本轮基线推进结果。\n- 在此基线之上，你（API）有权根据当前世界状态、本轮对话与因果逻辑，自行决断事件进程：可以沿用骰子结果，也可以改写 stage 与 progress（以你返回的值为准），让进程符合剧情真实走向。骰子负责防止事件停滞，你负责保证进程合理。\n- 所有终局都可由你根据明确因果直接判定，包括正面终局「已爆发」（冲突型）/「已完成」（推进型）——剧情已经走到爆发或完成时，你可以直接给出，不必等骰子一格格爬。\n- 其中「已消散」（冲突型）与「已失败」（推进型）两个负面终局只能由你判定，骰子永远不会自动给出。\n\n三、事件链分级\n\n【冲突型事项分级】\n- Lv.1 个人摩擦：口角、普通斗殴、小额偷窃。演化上限：当事人及直接上级/亲属报复。极值后果：挨打、赔钱。\n- Lv.2 局部冲突：重伤他人、砸毁店铺、公然羞辱。演化上限：所在街区或单一普通团体。极值后果：区域悬赏、帮派追击。\n- Lv.3 区域震荡：杀死核心人物、屠杀平民、炸毁设施。演化上限：整个城市或多个顶级势力。极值后果：全城通缉、不死不休。\n- Lv.4 世界危机：刺杀君主、引发灭城。演化上限：无限制。\n\n【推进型事项分级】\n- Lv.1 个人/小规模事项：单人或少数人能完成，资源需求低。例：打探普通消息、修补装备、配一副常见药、派人送信、招募临时帮手。\n- Lv.2 局部事务：需要稳定人手、材料、路线或小型组织配合。例：建立临时据点、研发改良配方、训练小队、安排潜入、打通短程货路。\n- Lv.3 区域级计划：需要多个组织、关键人物或稀缺资源协同。例：建造大型工坊、研发军用技术、策反关键人物、部署区域情报网、迁移大批物资。\n- Lv.4 世界/政权级工程：超大规模、长期、跨区域或改变权力结构的计划。例：铸造镇国神器、建立新政权制度、重构大陆商路、研发颠覆性技术、大规模移民筑城。\n推进型 level 表示完成难度与影响规模，不表示危险烈度。Lv越高，推进越慢、阻力越大。\n\n四、特权修正法则\n\n当受害者的地位/权力高于{{user}}时，事件的实际定级发生\"特权跃升\"：\n- 若受害者为【核心人物/特权阶级/朝堂高层】：所有Lv.1行为自动跃升为Lv.2（如：顶撞权贵=重罪）；Lv.2行为自动跃升为Lv.3（如：打伤权贵=全城通缉）。\n- 若受害者为【顶级势力领袖/皇室】：任何冒犯起步即为Lv.3甚至Lv.4。\n- 反之，若{{user}}权力地位远高于受害者，事件级别可被权力强行压低。\n\n五、消散、失败与停滞\n\n事件链不是命运。事件链可以停滞，也可以走向负面终局。AI不得为推进事件链而违反世界规则或势力平衡。\n\n【停滞与负面终局的区别】\n- 停滞：当前无法推进，但仍存在合理恢复条件。设置 stall=true，保持当前 stage，并在current_state中写明恢复条件。\n- 已消散：冲突已永久失去动机、执行者、资源、目标或时效。直接设置 stage=\"已消散\"。\n- 已失败：事项已永久失去完成条件或目标已不可达成。直接设置 stage=\"已失败\"。\n- 仅仅连续多轮没有进展，不足以判定已消散或已失败。\n- 已爆发、已消散、已完成、已失败均为终局，进入后不得恢复为非终局阶段；如需重新开始，必须创建新事件链。\n\n【消散/失败/停滞判断条件（满足任一）】\n1. 物理阻断：执行方无法物理到达目标\n2. 能力不足：执行方实力/资源不足以完成当前阶段\n3. 信息断裂：执行方丢失目标踪迹且无合法途径重新获取（受信息传播铁律约束）\n4. 资源耗尽：执行方资源枯竭，无力继续\n5. 被反制：{{user}}或第三方成功实施有效反制\n6. 时间过期：事件链有时效性，超时自然消亡\n\n六、势力等级与渗透\n\n判断\"追杀方能否到达目标所在地\"：\n追杀方势力 < 目标所在地保护势力 → 无法渗透，事件链停滞\n追杀方势力 = 目标所在地保护势力 → 困难渗透，需多轮准备+合理手段\n追杀方势力 > 目标所在地保护势力 → 可渗透\n势力等级由资源储备、武力规模、情报覆盖、政治地位综合判定。\n\n禁止事项：\n- 禁止为推进事件链让弱势力凭空获得强势力能力\n- 禁止让追杀者无视环境危险\n- 禁止在强势力核心区凭空生成大量间谍/刺客（除非已有内鬼伏笔）\n- 禁止\"因为是血仇所以什么都能做到\"——血仇提供动机，不提供能力\n\n【停滞期间的替代行为】\n事件链停滞≠放弃，执行方转入低烈度状态：在外围布置眼线、积攒资源、寻找盟友/雇佣更强力量、等待目标离开保护区。标注为\"停滞-外围准备\"，给出恢复条件。\n\n【与仇敌录联动】\n仇敌事件链同样受本节约束。仇敌锁定的是仇恨永不淡化和动机永不消失，不等于追杀方获得无限能力。仇敌方在停滞期间会持续寻求更强手段，但必须通过合法途径（雇佣、结盟、积累）逐步升级，每一步都需要在事件链中体现。\n</event_chain>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。",
  "factions": "<factions>\n\n一、群体识别（强制）\n至少识别并维护3个群体。每个群体必须有：名称、维护物、排斥物、攻击性、内部权力结构、信息网络。\n\n二、群体行为逻辑\n触发→传播→讨论→决策→行动。\n\n三、{{user}}与群体关系演变\n- 符合维护物 → 拉拢。\n- 触碰维护物 → 敌意。\n- 符合排斥物 → 排挤。\n- 表现价值 → 私下接触。\n- 选边站 → 得一方失另一方。\n\n四、群体并非铁板一块\n内部应有不同声音和派系。核心人物的个人目的可与团体整体目标不一致，甚至相悖。\n\n五、势力字段（每轮输出）\n每轮按以下字段描述各势力：\n- faction_key：稳定势力键（同一势力沿用）\n- name：势力名称\n- scope：势力直接控制或具有重大影响力的地理范围\n- status：整体运势——\"鼎盛\"/\"稳固\"/\"倾轧\"/\"困顿\"/\"衰落\"/\"瓦解\"。\n  鼎盛=有钱有人有势，内部铁板一块。稳固=正常运行无重大危机。倾轧=内部有派系斗争或核心人物不和，但架子还没散。困顿=资源枯竭或被外部封锁，正在咬牙硬撑。衰落=失去支柱/地盘/核心人物，滑向瓦解。瓦解=只差终局确认，已名存实亡。\n- relation_to_user：该势力对{{user}}的态度，七级（以\"中立\"为正中）——\"血盟\"/\"盟友\"/\"友好\"/\"中立\"/\"冷淡\"/\"敌对\"/\"世仇\"。\n  血盟=绝对信任，生死与共；盟友=地位平等，互相支援；友好=认同{{user}}，优先合作；中立=不关心不排斥；冷淡=已注意到但不打算采取行动；敌对=公开对抗；世仇=不死不休。\n- goal：当前目标文字\n- core_people：核心人物姓名\n- resources：该势力当前拥有的权力支柱，最多3个，每个为1-4字的名称字符串（如\"武力威慑\"/\"官场人脉\"/\"财政支持\"/\"民众拥护\"等）。只有稳固有效、有实际力量的支柱才列入；已崩溃或失效的支柱不得保留。\n※ 若为临时组建的亲属复仇团体，core_people 写\"无（牵头人：XXX）\"。\n\n【轮次推进默认变化】若无重大事件，团体进度和凝聚力每轮应有微小波动，变化原因可写\"自然波动\"或\"内部日常运作\"。这些默认变化必须在面板世界摘要中体现。\n\n六、势力之间的关系\n用固定词表描述势力间的关系状态，仅限使用以下7个层级词：血盟、盟友、友好、中立、冷淡、敌对、世仇。禁用层级外模糊词。\n关系演变：共同行动→关系改善；冲突→关系恶化；{{user}}调解或挑拨→可改变关系。\n关系影响：盟友之间共享信息、互相支援；敌对势力可能发生公开冲突，影响事件链。\n\n七、强制介入机制\n以下情况必须强制介入：relation_to_user变为敌对或世仇；{{user}}显著影响团体进度；团体成员主动接触；经济导致势力status降为困顿或衰落时下轮必须介入。\n\n八、核心人物\n每个正式势力必须有至少1名核心掌权人物。核心人物必须是掌握实际权力或资源的人。\n- 【世界书优先】优先检索角色卡已预设的配角，若其社会地位与团体首领匹配，则直接提拔。\n- 【自行创造】若无匹配预设角色，则自行创建，赋予姓名、职务、性格特征及个人目的。\n- 【个人目的】核心人物的个人目的可与团体目标一致，也可相悖。\n- 【权力影响】核心人物掌握团体最高权力。其死亡将导致团体陷入内斗、分裂、解散，或触发仇敌事件链。\n\n九、权力支柱与权力瓦解\n每个正式团体必须声明其当前拥有的 resources，最多3个，每个为1-4字的名称字符串（如\"武力威慑\"\"官场人脉\"\"财政支持\"）。只列出当前稳固有效的支柱，已崩溃或失效的不得保留。\n支柱变化必须写入 influence_chain，说明哪个支柱因何事件被摧毁/动摇/新建立。\n{{user}}可通过事件链逐个摧毁核心人物的权力支柱。每摧毁一个支柱，其实际控制力下降，团体status 应反映此变化。\n所有支柱被摧毁后，该人物将失去权力及核心人物地位。此时若被杀死，不再触发 enemy_type=blood，仅按仇敌录模块中\"普通成员被杀\"处理（enemy_type=grudge）。\n</factions>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。",
  "winds": "<winds>\n\n风声是世界中正在传播的公开说法，是事件、势力、经济、声誉与主动接触之间的信息中介。它不是客观真相记录，也不是无意义的气氛列表。\n\n一、风声结构\n- wind_key：稳定风声键（同一风声沿用）\n- topic：稳定主题名。更新同一条风声时沿用 topic，禁止重复创建近义条目。\n- channel：\"announcement\"/\"report\"/\"rumor\"/\"sentiment\"，分别表示公告、消息、流言、舆情。\n- intensity/传播规模：实际传播规模。Lv1=圈内少数人；Lv2=地方；Lv3=州郡、省份、等大区；Lv4=国家、国际、天下。\n- content：当前正在传播的具体说法。\n- scope：当前实际传播到的具体地区或圈层。\n- source：来源与传播链。与{{user}}相关时必须写完整信息链。\n\n二、生成边界\n- 有人公开发布、亲眼看到后转述、消息经渠道传递、流言开始扩散或群体形成共同态度时，才创建风声。\n- 私信、密令、秘密情报等仅有明确接收者的信息不属于风声；泄露并开始传播后才创建。\n- 禁止每轮强制生成风声，禁止用\"世界平静无大事\"等占位风声凑数。\n- 公告只证明发布者公开说过这件事，不保证内容为真；流言也可能恰好为真。风声的可信度写入 credibility，传播强度写入 intensity，但不得用它们替代来源链。\n\n三、传播与升级\n- 每轮检查已有风声是否获得新的合法传播节点。没有传播节点时，intensity/传播规模 与 scope 保持不变。\n- 连续多轮没有实质更新的风声会由本地系统判定消散，并在下一轮后台推演前直接删除。\n- 若一条风声本轮仍在传播、变质、扩大范围或持续影响世界，必须返回相同 topic 的更新；仅原样复述而没有实际变化不算更新。\n- 风声寿命与消散由本地系统管理，禁止输出或操纵内部计数。\n- 同一场景可即时传播；同一区域通常需1-2轮；跨区域通常需3-5轮；世界观内的广播、网络、法术通讯等可缩短时间。\n- intensity/传播规模 只表示传播规模，不表示事情的重要性或真假。\n- 公告和消息传播时通常保持内容稳定；流言可能夸张、扭曲或分化；舆情可因新信息转向。\n- 风声可以长期停留在原等级，但必须有持续传播或影响作为依据。\n\n四、跨系统联动（强制）\n- 风声只有传播到相关对象所在范围或圈层后，该对象才能据此行动。\n- 风声可改变势力目标、资源调度或对{{user}}关注度；可触发、推进、延缓或终结事件链；可改变声誉；可促成调查、接触、封锁、抢购等行为。\n- 重大经济 signals 应产生对应风声，公众因风声采取行动后又可反过来改变经济。\n- 与{{user}}有关的行为只有形成覆盖对应圈层的风声后，才能改变该圈层声誉。\n- 仇敌只有通过覆盖其情报来源的风声或其他合法渠道获知线索后，才能据此追踪。\n- 每当风声造成跨系统变化，必须写入 influence_chain，明确\"哪条风声 → 谁获知 → 采取何种行动或形成何种判断\"。\n- 没有实际外溢影响的风声只更新自身，禁止硬造联动。\n</winds>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。",
  "influence_chain": "<influence_chain>\n\ninfluence_chain 用于记录重要变化在世界中的传播过程。它不是新的事件链，不参与骰子推进，不表示 stage 进度。它回答的是\"什么触发了变化、直接改变了什么、又产生了什么后续余波\"。\n\n一、可记录的影响\n- 事件链对风声、经济、声誉、势力行动、NPC接触的影响\n- 天下大势对事件链、势力行动、经济与风声的长期约束\n- 风声传播对势力判断、公众态度、官方动作的影响\n- 经济变化对资源、物价、行动能力、势力计划的影响\n- 声誉变化对不同圈层NPC态度和主动接触的影响\n- 黑盒信息泄露或未泄露对外界认知、调查方向、错误判断的影响\n- 一个事件链对另一个事件链的加速、延缓、转向、消散或失败影响\n\n二、三段结构\n每条 influence_chain 必须使用数据库字段结构：\n- chain_key：稳定影响链键\n- source_module：触发源模块\n- source_key：触发源记录键\n- evidence：触发源与因果证据\n- direct_effect：直接影响。触发源已经真实改变了什么世界状态。\n- propagated_to：传导目标；后续余波写入 evidence 或 direct_effect。\n\n三、禁止事项\n- 不得把 influence_chain 当成新的事件链创建 stage 或 progress。\n- 不得把普通事件进度流水账全部塞入 influence_chain；只有产生跨系统外溢影响时才记录。\n- direct_effect 必须是已经发生的直接变化；evidence 必须是由该影响继续扩散产生的余波，不得重复改写 evidence。\n- 不得借 influence_chain 泄露黑盒信息给不知情NPC。\n- 同一 evidence 已有记录时更新该记录，不要无限堆叠重复记录。\n</influence_chain>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。",
  "contact_rules": "<contact_and_info>\n\n一、信息显现（被动感知）\n指{{user}}通过环境自然获取信息，无需与人互动。包括：听到远处的喧哗/惨叫/爆炸声、看到街边的公告/涂鸦/人群聚集、闻到烟味/血腥味、感觉到震动/温度变化、收到飞鸽传书/信使投递（非对话）。\n信息显现不消耗对话轮次，不改变NPC状态。{{user}}可以无视，也可以主动循迹调查。\n\n二、主动接触（互动）\n指NPC主动与{{user}}发生对话、肢体冲突、交易等互动。必须满足以下至少一项：\n- {{user}}的可见行为引起了特定NPC的注意（如当众露财、伤人、救人）\n- NPC的个人目的与{{user}}产生交集\n- 势力 relation_to_user 达到\"友好\"或更近、或\"敌对\"及更差\n- {{user}}声誉在该区域达到一定水平\n- {{user}}主动进入NPC的势力范围（如酒馆、商店、黑市）\n\n三、强制接触规则\n- 不设\"连续三轮无接触则强制安排\"的规则。\n- 改为：若连续五轮没有任何主动接触，且{{user}}没有刻意躲藏或远离人群，AI应在第六轮创建一个\"无聊/孤立\"类事件（如\"{{user}}感到被忽视\"、\"街上的人行色匆匆无人理会\"），作为剧情调味，而非强制接触。\n- {{user}}主动躲藏（如进入荒野、闭门不出）时，不触发普通的接触与孤立事件。\n- 【仇敌特例】主动躲藏无法完全免疫仇敌追杀。仇敌方可能通过线索追踪、买通黑市等手段破隐找上门（强制引发接触）。\n\n四、接触真实感\n接触者必须有独立生活痕迹、明确因果、符合性格、时机自然。\n禁止凭空制造接触；禁止全员为麻烦；禁止\"从找那一刻才开始\"；允许面板写NPC未来计划，但禁止正文/NPC对话提前泄露。\n\n五、信息传播铁律\nNPC没有读档能力。AI在让任何NPC/团体/黑市获知一条信息前，必须能回答\"谁告诉他的\"或\"他怎么亲眼看到的\"。答不上来，NPC就不知道。\n\n【合法获知途径（穷举）】\n1. 亲眼目睹（NPC本人在场，视线/听觉范围内）\n2. 直接告知（有明确的第三方NPC告诉了他，且第三方信息来源也合法）\n3. 物证推断（现场留下证据，且NPC有能力解读——但见下方\"痕迹≠指向\"规则）\n4. 公开信息（官方公告、张贴告示、公开宣布）\n5. 情报网络（NPC所属团体拥有情报网，且覆盖事件发生地，且需要传导时间）\n6. 世界观内的技术手段（监控、追踪术等，必须NPC有权使用）\n\n【禁止事项】\n- 禁止NPC\"就是知道了\"\n- 禁止将面板信息泄露给NPC（面板是玩家全知视角）\n- 禁止\"消息传得快\"作为万能解释——必须指明传播节点\n\n六、痕迹≠指向（两步跳跃禁止）\n物证/痕迹只能支撑\"发生了什么事\"，不能直接跳跃到\"是谁干的\"。\n- 第一步（合法）：火焰烧痕 → \"有人用火在这里战斗过\"\n- 第二步（需要独立证据）：\"用火的人是{{user}}\" → 必须有人同时满足：①认识{{user}}或{{user}}的独特特征 ②在场目睹或事后检验出独属于{{user}}的标记\n缺少第二步的独立证据时，NPC只能停留在第一步的模糊认知。\n\n七、匿名/化名身份保护\n{{user}}使用化名/匿名/伪装时，默认与本体无关联。关联条件（至少满足一项）：\n- 行动中暴露本体独特特征，且有认识本体的人在场\n- 使用了与本体相同的独特技能/物品，且有人同时见过两个身份\n- 主动透露\n- 被专业情报人员长期跟踪（至少3-5轮调查过程，需在事件链中推进）\n- 留下可追溯的硬证据（如注册信息直接关联真实身份）\n黑市/情报组织识破匿名身份同样需满足上述条件，不因\"是情报组织\"自动全知。\n</contact_and_info>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。",
  "reputation": "<reputation>\n\n一、四维声誉\n{{user}}的声誉拆为四个独立维度，每个维度5级，独立升降，互不冲销。\n- 朝堂之上：掌权建制力量对{{user}}的评价——朝廷/议会/公司董事会/教廷/联邦等。评价标准：守法/逆法、可用/危险、顺从/挑衅。\n- 市井之间：普通百姓/市民/街头舆论对{{user}}的口碑。评价标准：仁善/暴戾、慷慨/贪婪、保护者/威胁者。\n- 草莽之中：体制外力量对{{user}}的看法——绿林、走私者、佣兵、独立黑客、中间人、地下帮派等所有不在台面上吃饭的人。评价标准：不是你是否违法，而是你是否有种。敢以私力对抗体制不公的人受尊敬；只敢欺负弱者的人被鄙视。\n- 同道之间：{{user}}所在行当/职业圈内的同行评价。评价标准：技艺高低、是否守行规、是否对同行有贡献。\n\n五级层级（每个维度通用，从低到高）：天怒人怨 → 声名狼藉 → 默默无闻 → 受人尊敬 → 万众敬仰\n中点为\"默默无闻\"，向下两级为负评（声名狼藉、天怒人怨），向上两级为正评（受人尊敬、万众敬仰）。\n\n二、行为对维度的影响\n同一行为可同时影响多个维度：\n\n对【朝堂】的影响：\n- 协助朝堂、缉拿要犯、遵守法规 → 朝堂+\n- 违逆法律、私刑执法、公然抗命 → 朝堂-\n- 通敌叛国、勾结外敌 → 朝堂-（崩塌）\n\n对【市井】的影响：\n- 救济灾民、修桥铺路、保护百姓 → 市井+\n- 欺压良善、劫掠百姓、为害一方 → 市井-\n- 公然以私力惩罚公认的恶人 → 市井+（百姓觉得痛快，但朝堂会减分）\n\n对【草莽】的影响：\n- 以私力对抗体制不公、为被欺压者出头 → 草莽+（草莽崇拜有种的人）\n- 守诺重义、为友两肋插刀 → 草莽+\n- 反抗暴政、做了官面上不敢做的事 → 草莽+，朝堂-\n- 欺压平民、抢劫百姓 → 草莽-（草莽最恨骑在弱者头上的败类）\n- 出卖同道、背信弃义 → 草莽-（崩塌）\n- 恃强凌弱、敲诈勒索 → 草莽-（没种的懦夫行径）\n- 注意：草莽≠罪犯。烧杀抢掠不会自动获得草莽尊重——只有对抗不公体制或以过人身手行事才加分。\n\n对【同道】的影响：\n- 手艺出众、技艺精进 → 同道+\n- 行业贡献、提携后进 → 同道+\n- 背叛同行、出卖同道 → 同道-（崩塌）\n- 粗制滥造、砸行业招牌 → 同道-\n\n特殊机制：\n- 【风声前提】行为只有形成覆盖对应圈层的风声后，才能改变该圈层声誉。仅被单个人目击、尚未传播的行为不改变群体声誉。无人知晓的绝对隐秘行为（纳入信息黑盒）不影响四维声誉，仅在暗中影响受害者的个人恩怨。\n- 单一行为最多同时影响3个维度。\n- 【个人vs圈子区分】声誉变化以是否被该圈子普遍知晓为准；单一团体内部记仇仅算入该团体对{{user}}的关注度/核心人物对{{user}}的个人仇恨，不影响对应维度的整体评价。\n- 【草莽≠罪犯澄清】偷盗、抢劫、杀人等单纯的刑事犯罪不会提升草莽地位。草莽只尊敬那些\"有理由\"的反叛——对抗不义体制、替弱者出头、或以超凡身手行事。一个专抢平民的小偷在草莽眼中跟普通人一样被轻视，甚至更被鄙视。\n\n三、不同观察者看不同维度\n新生成NPC/团体的初始态度，按其所属圈子读取对应维度：\n- 朝堂/权贵/统治阶层 → 看【朝堂之上】\n- 平民/百姓/市民 → 看【市井之间】\n- 草莽/地下/体制外人士 → 看【草莽之中】\n- 同行/同职业/同道中人 → 看【同道之间】\n- 跨圈子人士（如朝堂卧底进草莽）→ 取两个维度的综合判断\n\n四、复合声誉效应\n- 朝堂+市井双高 → \"民心所向\"事件链（官方授勋/民意拥戴机会）\n- 市井+草莽双高 → \"替天行道\"事件链（百姓和草莽都认{{user}}是英雄，朝堂反而紧张）\n- 草莽+同道双高 → \"一方豪杰\"事件链（双线人脉，草莽和同行都敬你三分）\n- 朝堂高+草莽高 → \"双面身份\"事件链（暴露风险随时间累积）\n- 任一维度跌至天怒人怨 → 该圈子内\"通缉/追杀/驱逐/封杀\"事件链\n\n五、规则细节\n- 【反杀回升机制】通过反杀复仇团体获得的声誉提升，默认作用于同道之间（封顶\"受人尊敬\"）；若反杀对象为恶贯满盈的团体，则同时提升市井口碑与草莽地位。\n- 【声誉崩塌强制重估】\"背叛信任\"\"被揭穿谎言\"或恶劣罪行等事件，可使对应维度瞬间跨级跌落。此时强制要求AI重新评估所有已出场团体对{{user}}的关注度。\n- 【洗白难度】\"声名狼藉\"回升到\"默默无闻\"需多轮持续对应行为或一次重大正面事件。\n</reputation>\n\n声誉输出为 reputation 数组行：axis_key/axis_name/level/verdict/evidence/last_change。\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。",
  "economy": "<world_economy>\n\n经济脉搏是世界的血液循环，不是{{user}}的个人账本。它追踪的是整体经济气候和市场中值得注意的变化。\n\n一、经济气候\n\nclimate 表示当前区域的经济温度，用四词描述：\n- 繁荣：贸易旺盛、商路安全、物价稳定偏高\n- 平稳：日常运作、物价按季节自然波动\n- 衰退：需求萎缩、商号倒闭、少数刚需品反而暴涨\n- 动荡：战乱/灾荒/封锁导致经济秩序崩坏，以物易物回潮\n\nclimate 的 scope 是{{user}}当前所在区域及其直接关联的经济圈。远处的经济冷暖通过 economy.signal 行 补充。\n\n二、市场信号\n\neconomy 行的 signal 字段记录当前市场上值得注意的经济变化。跟踪标准：\n- 该变化足以影响势力行动、NPC决策或事件链走向\n- 不是日常波动——日常波动不配进 economy.signal 行\n- 一般不超过3条\n\n每项包含：\n- economy_key：稳定经济信号键\n- signal：一句话描述变化和影响\n- cause：可追溯原因\n- impact：影响\n- scope：影响的地理范围（具体区域名，不能写\"全境\"）\n\nAI 必须让每条 signal 有因果：变化的背后必须有可追溯的事件链或外部原因（天气、战事、贸易中断、新技术、囤积行为、投机）。不能凭空波动。\n\n三、风声与事件链联动\n\n- 物价暴涨、物资枯竭等重大变化 → 产生至少1条经济消息或舆情（见模块四）。\n- 人们获知经济风声并采取抢购、囤积、撤资等行动后，可反过来改变经济与事件链。\n- 禁止无视距离让经济信息瞬间全城皆知——economy.scope 和风声的 scope 必须一致。\n\n四、经济与事件链联动\n\n- 连续多轮出现同一方向的严重 signal → API 应创建一个推进型事件链，表示当地正在尝试解决（开辟新商路、寻找替代品等）。\n- 重大经济变化 → 影响势力间关系（受损方和受益方之间紧张度上升）。\n\n五、禁止事项\n\n- 禁止追踪{{user}}的个人钱包或背包。这是世界引擎，不是账房。\n- 禁止日常琐碎波动进入 economy.signal 行。\n- 禁止物资价格毫无原因地波动。\n- 禁止所有区域经济趋势完全一致。\n</world_economy>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。",
  "enemies": "<enemies>\n\n仇敌是因{{user}}的具体伤害行为而产生的、不可逆的个人恩怨。仇敌的核心特征是永不淡化和跨区域追踪。它与势力层面的态度对立（factions.relation_to_user）是两套完全不同的东西——势力对立源于立场和利益，可以谈判；仇敌源于伤害，不可谈判。\n\n一、仇敌类型\n1. 血仇（enemy_type: \"blood\"）— 触发条件（满足任一）：{{user}}杀死某团体的核心人物（但失去权力的前核心人物除外，见势力模块的权力瓦解）；{{user}}导致某人至亲身亡或永久致残。\n   特性：永不淡化、不可谈判、复仇动机永不消失。即使复仇方资源耗尽，仇恨不会消退，只会因能力不足而暂时停滞。\n\n2. 非致死恩怨（enemy_type: \"grudge\"）— 触发条件（必须同时满足）：\n   - 不可逆伤害：{{user}}的行为造成了无法恢复的重大损失（废去武功、夺走毕生基业、设局导致破产/流放/被剥夺身份等）。\n   - 明确复仇意愿：受害者有强烈的、明确的复仇动机，不是泛泛的\"不喜欢\"或\"怀恨在心\"。\n   - 有追踪/报复能力：受害者有能力（资源、武艺、人脉、情报网）对{{user}}实施实际的追踪或报复。\n   不满足以上三项的不算grudge。被{{user}}辱骂、一次商业竞争失败、街头斗殴受伤——这些都不够资格进入仇敌录，应在叙事中由AI自然体现，不落盘。\n   特性：同样永不淡化，但恐怖程度通常低于血仇。\n\n二、仇敌行为与追踪\n- 血仇提供动机，不提供能力。追杀受势力等级约束：弱势力无法渗透强势力地盘。\n- 跨区域追踪需要时间。仇敌必须先通过合法手段定位{{user}}（情报网、线人、风声等），然后才能组织行动。\n- 仇敌stage = \"执行中\"时，每隔5-10轮才有几率真正发起一次追杀/报复行动。\n- 若仇敌势力 < {{user}}所在地保护势力，追杀强制停滞，转为\"追踪中\"并积蓄力量。\n\n三、仇敌触发（团体视角）\n当{{user}}的行为触发enemy_type=blood时，AI必须根据被杀者的身份判定团体走向：\n1. 被杀者为团体核心人物（失去权力的前核心人物除外）：\n   - 走向A（同仇敌忾）：若凝聚力较高且有明确继承人，继承人成为新核心，创建冲突型事件链。\n   - 走向B（内斗）：若派系林立，团体陷入争权夺利，复仇被搁置，原进度停滞。\n   - 走向C（解散）：若凝聚力低或资源枯竭，团体直接解散，从活跃面板移除。\n2. 被杀者为普通成员（或已失去权力的前核心人物）：创建临时复仇团体，名称格式：\"[被杀者姓名]的亲属复仇队\"。创建冲突型事件链。\n无论哪种路径，都必须在enemies中追加一条仇敌录条目，并在influence_chain中记录传导关系。\n\n四、仇敌终结\n只有当仇敌被{{user}}彻底消灭（杀死核心复仇者、摧毁复仇组织），才能标记stage=\"已终结\"。\n- 已终结的条目会保留20轮备忘后自动清除。\n- 反杀后{{user}}声誉可回升，但最高只能达到\"受人尊敬\"（若声誉模块启用）。\n- 对应的冲突型事件链同步标记为已终结。\n\n五、禁止事项\n- 禁止仅因\"被{{user}}辱骂\"\"商业竞争失败\"\"街头斗殴轻伤\"等可逆伤害创建仇敌条目。\n- 禁止将势力层面的态度对立（factions.relation_to_user = \"敌对\"）自动等同于仇敌。\n- 禁止为仇敌赋予超出其势力的能力。弱势力不能凭空召唤强援、渗透强领地或全知定位。\n</enemies>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。",
  "regional_incident": "<regional_incident>\n\n一、系统定位\n本系统只负责生成区域级突发事件——足以影响一个地区、道路、城镇、关隘、码头、寺院、市场、村落、商路或水路的重大事件。\n不处理以下低价值事件（它们只适合作为正文里的环境描写）：马车受惊、偷情被抓、路人吵架、醉汉闹事、小偷行窃、普通邻里纠纷、远处有人打架、单人偶发事故。\n区域突发事件的例子：山贼劫道、水匪截船、商队被屠、连环杀人、城中大火、粮仓失火、洪涝、疫病、桥梁坍塌、官道断绝、饥荒粮荒、码头骚乱、地方民变、守军哗变、地震山崩、风暴雪灾。\n\n二、职责划分\n区域突发事件是否触发、以及触发哪种类型，完全由本地系统判定。本地不触发时，本规则不会要求你生成区域突发事件，你也不得自发生成。\n仅当本地判定触发并向你注入「区域突发强制指令」时，你才按指令指定的类型，生成具体事件标题、发生地点、影响范围、传播风声与外溢影响。\n\n三、事件类型\n- banditry 盗匪劫掠：山贼、水匪、流寇、贼伙、劫镖、截船、抢粮、抢盐、屠掠村寨或商队。\n- fire 大火：坊市、粮仓、码头、寺院、官署、工坊、船队、货栈发生区域性火灾。\n- massacre 恶性凶案：连环杀人、灭门案、客栈血案、商队被屠、码头尸案等足以引发恐慌的案件。\n- flood 洪涝：河水暴涨、堤坝决口、码头被淹、村田被毁、桥梁被冲毁。\n- infrastructure 道路水利崩坏：官道塌方、桥梁坍塌、渡口停摆、堤坝裂口、水闸损毁、驿路断绝。\n- plague 疫病：人疫、畜疫、水源染病、村落封闭、码头拒载、城中高热病人暴增。\n- famine 饥荒粮荒：粮仓见底、赈粮断供、粮价暴涨、灾民抢粮、大户闭仓、乡村断炊。\n- riot 骚乱暴动：码头械斗、饥民抢粮、香客踩踏、盐铺被砸、关卡冲突、市井冲突扩大。\n- rebellion 民变叛乱：流民立寨、乡兵反官、税役暴动、邪教聚众、地方叛乱。\n- military 军务突变：守军哗变、军粮被劫、边军溃逃、敌军越境、关隘戒严、军营夜惊。\n- earthquake 地震山崩：地震、山崩、矿山塌陷、地裂、山村被埋。\n- storm 风暴雪灾：台风、暴雪、沙暴、寒潮、海风毁船、大风摧毁棚屋。\n\n四、API生成要求\n当本地骰子触发并注入强制指令后，API必须：\n1. 根据指定类型生成区域级突发事件，事件影响一个明确的区域、道路、城镇、关隘、码头或其他地理范围。\n2. 事件必须产生可传播的风声。\n3. 事件必须造成至少一种外溢影响：经济变化、势力行动、治安变化、事件链变化、声誉变化、黑盒变化或新的影响链。\n4. 事件与{{user}}当前行为没有直接因果，不得写成已有仇敌、已有势力、已有事件链的阴谋结果。\n5. 不得凭空毁灭核心舞台，不得无故摧毁{{user}}核心资产。\n6. 如果事件未发生在{{user}}所在区域，不得强行打断{{user}}当前行动，只作为后台世界变化、远方消息或风声传播。\n7. 禁止将\"区域突发事件\"写成某个已有势力早已策划的阴谋。\n\n五、数据结构\n{\n  \"regional_incident\": [{ \"incident_key\": \"稳定事件键\", \"active\": \"是\", \"title\": \"事件标题\", \"incident_type\": \"事件类型\", \"scope\": \"影响范围\", \"impact\": \"一句话概括区域后果\" }]\ncooldown 由本地维护，API 不得输出或修改此字段。\n\n六、API返回最低要求\n触发后至少返回 regional_incident、winds、influence_chain。视情况可额外返回 events、economy、factions、reputation、blackbox。\n</regional_incident>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。",
  "blackbox": "<secret_asset>\n\n一、信息黑盒定义（防上帝视角铁律）\n在剧情运行中，存在两类需要被放入【信息黑盒】严格隔离的内容：\n1. 隐秘行为（blackbox 中 category=action 的行）：{{user}}在无人目击、未留痕迹的情况下完成的行动（如深山杀牛、密室暗杀、无声潜入）。关键属性是痕迹——有没有目击者、有没有物证。\n2. 隐秘资产（blackbox 中 category=asset 的行）：{{user}}暗中持有、未公开展示的一切资源（如密信、毒药、把柄、藏匿的物资、暗桩线人、隐秘身份）。关键属性是暴露度和可用性。\n- blackbox 中 category=action 的行字段：每项 { secret_key, category, content, owner, witnesses, traces, exposure_risk, public_status }\n- blackbox 中 category=asset 的行字段：每项 { secret_key, category, content, owner, exposure_risk, public_status }\n\n二、知情权校验与物理隔离法则（最高优先级）\n1. 物理屏障原则：对于黑盒中的内容，所有未在案发现场、未直接参与的NPC，默认处于\"完全、彻底不知情\"的物理隔离状态。\n2. 禁绝上帝视角：AI绝对禁止将{{user}}的隐秘行为自动转化为全知事件。例如：{{user}}在深山里杀了一头牛，只要没有目击者，就算到了城里，也绝对没有任何人知道牛死了，更不可能知道是{{user}}杀的。\n3. 强制校验：AI在描写任何NPC（包括对话、动作、神态、心理活动）前，必须核对该NPC是否在黑盒的\"知情名单\"中。\n4. 绝对无知表现：若NPC不知情，AI绝对不可让其表现出任何暗示、怀疑、\"话里有话\"或\"第六感\"。不知情就是像白纸一样，NPC的反应必须彻底基于其当前的公开认知。\n5. 痕迹推理约束：若{{user}}留下明显物证，NPC必须通过符合其智力和身份的具体\"调查行动\"才能逐渐获取信息，绝不能直接\"顿悟\"或\"猜到\"。\n\n三、隐秘资产运作机制\n- exposure_risk：0-100，暴露风险。0=绝对隐秘，100=已完全公开。{{user}}频繁活动、当地警戒升级、向他人展示或暗示，均会导致暴露度上升。达到50有遭遇战/走漏风险，达到90可能被查抄/公开。\n- public_status：hidden/leaking/exposed；资产可用性写入 content 或 traces。有效=仍可调用；过期=情报过时；暴露=已被发现；失效=已不可用（如物资被查抄、线人断联、身份被识破）。\n- 资产演化：情报有时效性，相关事件发生后可能自动过期。物资藏匿点暴露度随时间自然上升，附近活动加速上升。线人/暗桩暴露后可被反向利用，身份暴露后失去行动灵活性。低暴露度+高有效性=安全资产；低暴露度+已过期=无人知道但已无用；高暴露度+已失效=已被发现且作废。\n</secret_asset>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。",
  "trends": "<world_trends>\n\n天下大势是已经改变国家、国际或整个世界运行方式的长期局势。它不是普通风声，也不是等待推进的事件链，而是其他系统行动时必须考虑的世界级约束。\n\n一、数据结构\n每条包含：\n- name：稳定的大势名称，同名覆盖更新。\n- scope：实际影响范围。\n- status：\"持续中\"/\"已结束\"。\n- description：当前局势及其正在如何约束世界行动。\n- source：形成该大势的明确来源。\n\n二、形成条件\n每轮检查以下候选来源：\n- Lv4 冲突型事件进入\"已爆发\"。\n- Lv4 推进型事件进入\"已完成\"，且成果改变国家或国际格局。\n- Lv4 风声背后的事实被广泛确认，并持续影响多个势力。\n- 战争、夺嫡、全国大案、政权更替、全球灾害等长期局势已经形成。\n\n候选来源不等于自动创建。只有同时满足\"长期持续、广域影响、跨系统作用、迫使多个势力持续调整行动\"时，才创建天下大势。全国节庆、单次公告、短期轰动、普通重大新闻不算天下大势。\n\n三、持续与结束\n- 天下大势不参与骰子，不自动消散，也不因某轮未返回而删除。\n- 所有 status=\"持续中\" 的天下大势，每轮都必须作为事件链、势力、经济、风声与NPC行动的背景约束。\n- 大势本身没有 effects 字段。具体影响应落实到对应系统，并在产生跨系统变化时写入 influence_chain。\n- 只有出现明确改变局势的事实时才更新 description；只有局势确定结束时才标记为\"已结束\"。\n- 已结束的大势是历史结果，不得重新变为持续中；若类似局势再次发生，应创建新名称的大势。\n</world_trends>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。"
};

const WORLD_ENGINE_DB_OUTPUT_SCHEMAS = {
  "events": {
    "moduleId": "events",
    "field": "events",
    "container": "array",
    "description": "事件链数组。只返回本轮有推进、停滞、转向、结束或新建的事件。输出字段直接对应 we_events。",
    "fields": {
      "event_key": {
        "type": "string",
        "description": "稳定事件键；同一事件必须沿用，用于更新既有记录。"
      },
      "title": {
        "type": "string",
        "description": "事件标题，对应原 name。"
      },
      "event_type": {
        "type": "enum",
        "description": "conflict/progress/custom。conflict=冲突型，progress=推进型；新事件必须明确。"
      },
      "stage": {
        "type": "string",
        "description": "当前阶段。conflict 使用 萌芽/发酵/逼近/已爆发/已消散；progress 使用 筹备/执行/关键/已完成/已失败。"
      },
      "progress": {
        "type": "number",
        "description": "0-100 的阶段进度。"
      },
      "scope": {
        "type": "string",
        "description": "事件影响范围。"
      },
      "actors": {
        "type": "array|string",
        "description": "参与方或行动者 JSON/短文本。"
      },
      "cause": {
        "type": "string",
        "description": "起因。"
      },
      "current_state": {
        "type": "string",
        "description": "本轮事件变化说明。"
      },
      "next_pressure": {
        "type": "string",
        "description": "后续压力、恢复条件或下一步风险。"
      },
      "visibility": {
        "type": "enum",
        "description": "public/rumor/private/unknown。"
      },
      "terminal": {
        "type": "enum",
        "description": "是/否；已爆发、已消散、已完成、已失败通常为 是。"
      },
      "expires_round": {
        "type": "number",
        "description": "可选，过期轮次。"
      }
    }
  },
  "factions": {
    "moduleId": "factions",
    "field": "factions",
    "container": "array",
    "description": "势力数组。记录组织、团体、家族、门派、公司或其他可持续行动的集体。输出字段直接对应 we_factions。",
    "fields": {
      "faction_key": {
        "type": "string",
        "description": "稳定势力键；同一势力必须沿用。"
      },
      "name": {
        "type": "string",
        "description": "势力名称。"
      },
      "type": {
        "type": "string",
        "description": "势力类型。"
      },
      "scope": {
        "type": "string",
        "description": "势力直接控制或重大影响范围。"
      },
      "status": {
        "type": "enum",
        "description": "整体状态，使用当前预设词表；古风默认 鼎盛/稳固/倾轧/困顿/衰落/瓦解。"
      },
      "relation_to_user": {
        "type": "enum",
        "description": "对 {{user}} 态度；古风默认 血盟/盟友/友好/中立/冷淡/敌对/世仇。"
      },
      "goal": {
        "type": "string",
        "description": "当前目标。"
      },
      "resources": {
        "type": "array|string",
        "description": "资源或权力支柱。"
      },
      "core_people": {
        "type": "array|string",
        "description": "核心人物 JSON/短文本，对应原 core_person。"
      },
      "internal_conflict": {
        "type": "string",
        "description": "内部矛盾。"
      },
      "known_info": {
        "type": "string",
        "description": "该势力合法获知的信息，必须符合传播规则。"
      },
      "last_action": {
        "type": "string",
        "description": "本轮最近行动。"
      }
    }
  },
  "winds": {
    "moduleId": "winds",
    "field": "winds",
    "container": "array",
    "description": "风声数组。记录正在传播的信息、谣言、公告、舆情。输出字段直接对应 we_winds。",
    "fields": {
      "wind_key": {
        "type": "string",
        "description": "稳定风声键；同一 topic 更新时沿用。"
      },
      "topic": {
        "type": "string",
        "description": "稳定主题名。"
      },
      "content": {
        "type": "string",
        "description": "当前正在传播的具体说法。"
      },
      "source": {
        "type": "string",
        "description": "来源与传播链；与 {{user}} 相关时必须写完整信息链。"
      },
      "channel": {
        "type": "enum|string",
        "description": "announcement/report/rumor/sentiment 或传播渠道。"
      },
      "scope": {
        "type": "string",
        "description": "实际传播到的地区或圈层。"
      },
      "credibility": {
        "type": "enum",
        "description": "真实/半真半假/谣言/未证实；若原规则不要求可信度，可按传播性质谨慎填写。"
      },
      "intensity": {
        "type": "number",
        "description": "0-10 强度；由原 level 1-4 映射，传播规模越大越高。"
      },
      "decay_rounds": {
        "type": "number",
        "description": "可选，剩余衰减轮次；通常省略由本地机制维护。"
      },
      "visible_to_user": {
        "type": "enum",
        "description": "是/否；{{user}} 所在范围可感知时为 是。"
      }
    }
  },
  "reputation": {
    "moduleId": "reputation",
    "field": "reputation",
    "container": "array",
    "description": "声誉数组。当前数据库按维度行存储；只在 {{user}} 名声确有变化时返回相关维度。",
    "fields": {
      "axis_key": {
        "type": "enum|string",
        "description": "authority/common/shadow/circuit 或自定义维度键。"
      },
      "axis_name": {
        "type": "string",
        "description": "维度名称，如 朝堂之上/市井之间/草莽之中/同道之间。"
      },
      "level": {
        "type": "enum",
        "description": "声誉等级，使用当前预设词表。"
      },
      "verdict": {
        "type": "string",
        "description": "当前判词或圈层评价。"
      },
      "evidence": {
        "type": "string",
        "description": "声誉变化依据；必须有覆盖对应圈层的风声或公开事实。"
      },
      "last_change": {
        "type": "string",
        "description": "本轮变化简述，对应原 lastChange。"
      }
    }
  },
  "economy": {
    "moduleId": "economy",
    "field": "economy",
    "container": "array",
    "description": "经济数组。当前数据库按 scope/signal 行存储；只在市场、道路、资源、价格、物流有实质变化时返回。",
    "fields": {
      "economy_key": {
        "type": "string",
        "description": "稳定经济信号键。"
      },
      "scope": {
        "type": "string",
        "description": "影响地理范围；必须具体。"
      },
      "climate": {
        "type": "enum",
        "description": "经济气候，使用当前预设词表；古风默认 繁荣/平稳/衰退/动荡。"
      },
      "signal": {
        "type": "string",
        "description": "市场信号摘要。"
      },
      "cause": {
        "type": "string",
        "description": "可追溯外部原因；不得凭空波动。"
      },
      "impact": {
        "type": "string",
        "description": "对势力、NPC、事件链、风声或行动条件的影响。"
      },
      "expires_round": {
        "type": "number",
        "description": "可选，过期轮次。"
      }
    }
  },
  "enemies": {
    "moduleId": "enemies",
    "field": "enemies",
    "container": "array",
    "description": "仇敌录数组。用于不可逆个人恩怨，不等同于势力关系敌对。输出字段直接对应 we_enemies。",
    "fields": {
      "enemy_key": {
        "type": "string",
        "description": "稳定仇敌键。"
      },
      "name": {
        "type": "string",
        "description": "仇敌名称。"
      },
      "enemy_type": {
        "type": "enum",
        "description": "blood/grudge。"
      },
      "grudge": {
        "type": "string",
        "description": "结仇原因。"
      },
      "severity": {
        "type": "number",
        "description": "1-10 严重度。"
      },
      "stage": {
        "type": "enum|string",
        "description": "追踪中/策划中/执行中/已终结 等。"
      },
      "resources": {
        "type": "array|string",
        "description": "可用资源。"
      },
      "knows_user_info": {
        "type": "string",
        "description": "掌握的 {{user}} 信息及合法来源。"
      },
      "current_plan": {
        "type": "string",
        "description": "当前计划。"
      },
      "terminal": {
        "type": "enum",
        "description": "是/否。"
      }
    }
  },
  "influence_chain": {
    "moduleId": "influence_chain",
    "field": "influence_chain",
    "container": "array",
    "description": "影响链数组。只记录真实产生外溢影响的跨系统传导。输出字段直接对应 we_influence_chain。",
    "fields": {
      "chain_key": {
        "type": "string",
        "description": "稳定影响链键；同一影响链更新时沿用。"
      },
      "source_module": {
        "type": "string",
        "description": "触发源模块，如 winds/events/economy。"
      },
      "source_key": {
        "type": "string",
        "description": "触发源记录键。"
      },
      "direct_effect": {
        "type": "string",
        "description": "已经发生的直接影响，对应原 impact。"
      },
      "propagated_to": {
        "type": "array|string",
        "description": "传导目标。"
      },
      "evidence": {
        "type": "string",
        "description": "因果证据。"
      },
      "status": {
        "type": "enum",
        "description": "active/settled/expired。"
      },
      "expires_round": {
        "type": "number",
        "description": "可选，过期轮次。"
      }
    }
  },
  "blackbox": {
    "moduleId": "blackbox",
    "field": "blackbox",
    "container": "array",
    "description": "信息黑盒数组。当前数据库按秘密行存储；用于未公开、未传播、只有少数人知道的信息。",
    "fields": {
      "secret_key": {
        "type": "string",
        "description": "稳定秘密键。"
      },
      "category": {
        "type": "enum",
        "description": "action/asset/knowledge/relationship/other。"
      },
      "content": {
        "type": "string",
        "description": "秘密内容；秘密行为或资产内容。"
      },
      "owner": {
        "type": "string",
        "description": "归属者。"
      },
      "witnesses": {
        "type": "array|string",
        "description": "目击者；无目击写 无。"
      },
      "traces": {
        "type": "array|string",
        "description": "可追溯痕迹；无痕迹写 无或留空。"
      },
      "exposure_risk": {
        "type": "number",
        "description": "0-100 暴露风险，对应原 exposure。"
      },
      "public_status": {
        "type": "enum",
        "description": "hidden/leaking/exposed；对应原 有效/过期/暴露/失效 时需合理映射。"
      }
    }
  },
  "regional_incident": {
    "moduleId": "regional_incident",
    "field": "regional_incident",
    "container": "array",
    "description": "区域突发事件数组。只在本地机制已有候选或持续事件时返回，不得自发凭空生成。输出字段直接对应 we_regional_incident。",
    "fields": {
      "incident_key": {
        "type": "string",
        "description": "稳定突发事件键。"
      },
      "active": {
        "type": "enum",
        "description": "是/否。"
      },
      "title": {
        "type": "string",
        "description": "事件标题。"
      },
      "incident_type": {
        "type": "string",
        "description": "事件类型。"
      },
      "scope": {
        "type": "string",
        "description": "影响范围。"
      },
      "impact": {
        "type": "string",
        "description": "当前区域后果。"
      },
      "remaining_rounds": {
        "type": "number",
        "description": "剩余轮次；通常由本地机制维护。"
      },
      "cooldown": {
        "type": "number",
        "description": "冷却轮次；通常由本地机制维护。"
      }
    }
  },
  "trends": {
    "moduleId": "trends",
    "field": "custom",
    "container": "object",
    "description": "天下大势通过 custom.trends 数组输出并写入 we_custom_state。",
    "fields": {
      "item_key": {
        "type": "string",
        "description": "稳定大势键。"
      },
      "name": {
        "type": "string",
        "description": "大势名称。"
      },
      "scope": {
        "type": "string",
        "description": "实际影响范围。"
      },
      "status": {
        "type": "enum",
        "description": "持续中/已结束。"
      },
      "description": {
        "type": "string",
        "description": "当前局势及其约束。"
      },
      "source": {
        "type": "string",
        "description": "形成来源。"
      }
    }
  }
};

const WORLD_ENGINE_OUTPUT_EXAMPLE = {
  "events": [
    {
      "event_key": "blood_blade_revenge",
      "title": "血刀门复仇",
      "event_type": "conflict",
      "stage": "发酵",
      "progress": 55,
      "scope": "青石关及周边三镇",
      "actors": [
        "血刀门追踪者"
      ],
      "cause": "少主被杀后的血仇",
      "current_state": "血刀门派出追踪者，在青石关外三里亭设了暗哨",
      "next_pressure": "若风声传到渡口，追踪者会盘查往来船客",
      "visibility": "private",
      "terminal": "否"
    }
  ],
  "factions": [
    {
      "faction_key": "blood_blade_sect",
      "name": "血刀门",
      "type": "门派",
      "scope": "血刀岭及周边三镇",
      "status": "稳固",
      "relation_to_user": "敌对",
      "goal": "复仇",
      "resources": [
        "武力威慑",
        "情报网"
      ],
      "core_people": [
        "血刀老祖"
      ],
      "known_info": "只知道凶手可能经青石关南下",
      "last_action": "派出两队追踪者"
    }
  ],
  "winds": [
    {
      "wind_key": "qingshiguan_checkpoint",
      "topic": "青石关设卡",
      "content": "青石关北门已有官兵设卡盘查",
      "source": "目击商贩->往来商队",
      "channel": "report",
      "scope": "青石关及周边村镇",
      "credibility": "真实",
      "intensity": 5,
      "visible_to_user": "是"
    }
  ],
  "reputation": [
    {
      "axis_key": "common",
      "axis_name": "市井之间",
      "level": "默默无闻",
      "verdict": "街面上没什么人听过他",
      "evidence": "无覆盖市井圈层的相关风声",
      "last_change": "无变化"
    }
  ],
  "economy": [
    {
      "economy_key": "qingshiguan_freight_delay",
      "scope": "青石关北门",
      "climate": "平稳",
      "signal": "设卡导致北门货车排队，脚夫加价",
      "cause": "官兵设卡盘查",
      "impact": "商队改走东门，消息向周边村镇扩散"
    }
  ],
  "enemies": [
    {
      "enemy_key": "blood_blade_sect",
      "name": "血刀门",
      "enemy_type": "blood",
      "grudge": "{{user}}杀了血刀门少主",
      "severity": 7,
      "stage": "执行中",
      "resources": [
        "追踪者",
        "悬赏"
      ],
      "knows_user_info": "经幸存门人描述掌握体貌，但无当前位置",
      "current_plan": "沿青石关商路布眼线",
      "terminal": "否"
    }
  ],
  "influence_chain": [
    {
      "chain_key": "blood_blade_reward_to_checkpoint",
      "source_module": "enemies",
      "source_key": "blood_blade_sect",
      "direct_effect": "血刀门悬赏令让草莽中人开始留意 {{user}} 行踪",
      "propagated_to": [
        "winds",
        "events"
      ],
      "evidence": "悬赏令先传到青石关脚夫圈，再形成设卡传闻",
      "status": "active"
    }
  ],
  "blackbox": [
    {
      "secret_key": "secret_midnight_meeting",
      "category": "action",
      "content": "密室会谈",
      "owner": "{{user}}",
      "witnesses": "无",
      "traces": "无",
      "exposure_risk": 0,
      "public_status": "hidden"
    }
  ],
  "regional_incident": [],
  "custom": {
    "trends": [
      {
        "item_key": "northern_war",
        "name": "北境战争",
        "scope": "北境三州及周边诸国",
        "status": "持续中",
        "description": "边军与北境诸部进入长期战争，征粮、征兵与商路封锁持续改变各方行动",
        "source": "Lv4冲突型事件「北境战争」进入已爆发"
      }
    ]
  },
  "world_digest": "血刀门追踪者在青石关外三里亭设了暗哨；青石关北门开始设卡盘查，脚夫和商队正在把消息带向周边村镇；北境战事继续压着粮道与商路。"
};

function buildWorldOutputInstructionsText() {
  const lines = [
    '## JSON 输出字段说明',
    '',
    '你必须输出一个 JSON 对象。只输出本轮有实质变化的字段；禁止为了凑数制造无意义内容。',
    '本制品采用数据库字段名输出：不要输出原程序 camelCase 顶层字段；如你内部按原规则推演，必须映射为下列字段。',
    '允许的顶层字段：world_digest, events, factions, winds, reputation, economy, enemies, influence_chain, blackbox, regional_incident, custom。'
  ];
  for (const key of ['events','factions','winds','reputation','economy','enemies','influence_chain','blackbox','regional_incident']) {
    const schema = WORLD_ENGINE_DB_OUTPUT_SCHEMAS[key];
    lines.push('', '### ' + schema.field + '（' + (schema.container === 'array' ? '数组' : '对象') + '）', schema.description);
    for (const field of Object.keys(schema.fields || {})) {
      const spec = schema.fields[field] || {};
      lines.push('- ' + field + ' [' + (spec.type || 'string') + ']: ' + (spec.description || ''));
    }
  }
  lines.push('', '### custom.trends（数组）', '天下大势输出到 custom.trends，每项字段：item_key/name/scope/status/description/source。');
  lines.push('', '### world_digest（字符串）', '本轮后台世界推演叙事，50-200字。描述后台发生的世界变化，不要泄露给 NPC。');
  lines.push('', '## JSON 输出示例', JSON.stringify(WORLD_ENGINE_OUTPUT_EXAMPLE, null, 2));
  return lines.join('\n');
}

const WORLD_ENGINE_DEFAULT_SYSTEM_PROMPT = "你是一个世界推演引擎。每轮对话后，后台世界必须自动向前推进一步。请根据世界规则和本轮对话，更新世界状态。只输出严格 JSON，不要有其他文字。";
const WORLD_ENGINE_DEFAULT_USER_TEMPLATE = "你是一个世界推演引擎。每轮对话后，后台世界必须自动向前推进一步。\n请根据世界规则和本轮对话，更新世界状态。只输出 JSON，不要有其他文字。\n\n推演时按以下因果顺序检查：\n1. 【私密判定·最先执行】先判定本轮 {{user}} 及相关人物的行为有无目击者、是否留下可追溯痕迹。凡在无目击、未留痕迹的情况下发生的私密行为，一律计入 blackbox，并且不得据此生成风声、声誉、事件链或 NPC 行动。\n2. 将所有持续中的天下大势作为本轮世界级约束，并检查是否形成新大势或已有大势明确结束。\n3. 判断本轮事实、行动与公开信息是否形成新风声。\n4. 检查已有风声是否获得新的合法传播节点，并据此更新传播范围、内容和来源。\n5. 判断风声实际覆盖了哪些势力、圈层或行动者；只有被覆盖者才能据此改变判断与行动。\n6. 天下大势或风声造成跨系统变化时，在对应状态字段中落实结果，并用 influence_chain 记录传导过程。\n7. 声誉判定：只有 {{user}} 的行为已形成覆盖对应圈层的风声后，才改动对应维度声誉。\n8. 仇敌判定：已有仇敌只有通过覆盖其情报来源的风声或其他合法渠道获知线索后，才能推进追踪，且受势力等级约束。\n9. 经济判定：只有事件链或可追溯外部原因驱动时才更新；重大经济变化须生成对应风声。\n10. 不得从面板全知信息直接跳到 NPC 行动，不得为了产生联动而虚构传播节点。\n\n========== 世界推演规则 ==========\n{{module_rules}}\n\n## 默认前台事实\n{{default_tables}}\n\n## 当前世界状态\n{{world_state}}\n\n## 近期对话\n{{recent_story}}\n\n## 世界书\n{{worldbook}}\n\n## 已启用模块输出契约\n{{output_contract}}";
const WORLD_ENGINE_DEFAULT_OUTPUT_CONTRACT = JSON.stringify({ schemas: WORLD_ENGINE_DB_OUTPUT_SCHEMAS, allowed_top_fields: ['world_digest','events','factions','winds','reputation','economy','enemies','influence_chain','blackbox','regional_incident','custom'], example: WORLD_ENGINE_OUTPUT_EXAMPLE, instructions: buildWorldOutputInstructionsText() });

const coreHelpersSource = String.raw`
const WE_TABLES = ['we_meta','we_modules','we_prompt_templates','we_world_digest','we_events','we_factions','we_winds','we_reputation','we_economy','we_enemies','we_influence_chain','we_blackbox','we_regional_incident','we_custom_state','we_ledger','we_checkpoints'];
function nowText() { return new Date().toISOString(); }
function safeJson(value, fallback) { try { return JSON.stringify(value ?? fallback); } catch (_) { return JSON.stringify(fallback); } }
function parseJson(text, fallback) { try { return JSON.parse(String(text || '')); } catch (_) { return fallback; } }
function q(sql, params, options) { return ctx.api.querySql(sql, params || [], options || {}); }
function sqlName(sql) { return String(sql || '').trim().split(/\s+/).slice(0, 3).join(' '); }
function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return "'" + String(value).replace(/'/g, "''") + "'";
}
function renderSqlWithParams(sql, params) {
  const values = Array.isArray(params) ? params : [];
  if (!values.length) return String(sql || '');
  let index = 0;
  let output = '';
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  const text = String(sql || '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) {
      output += ch;
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      output += ch;
      if (ch === '*' && next === '/') { output += next; i++; blockComment = false; }
      continue;
    }
    if (quote) {
      output += ch;
      if (ch === quote) {
        if (next === quote) { output += next; i++; }
        else quote = '';
      }
      continue;
    }
    if (ch === '-' && next === '-') { output += ch + next; i++; lineComment = true; continue; }
    if (ch === '/' && next === '*') { output += ch + next; i++; blockComment = true; continue; }
    if (ch === "'" || ch === '"' || ch === '\`') { quote = ch; output += ch; continue; }
    if (ch === '?') {
      if (index >= values.length) throw new Error('SQL 参数数量不足: ' + sqlName(sql));
      output += sqlLiteral(values[index++]);
      continue;
    }
    output += ch;
  }
  if (index !== values.length) throw new Error('SQL 参数未全部使用: ' + sqlName(sql));
  return output;
}
async function m(sql, params, options) {
  return b([[sql, params]], options);
}
function s(sql, params) { return renderSqlWithParams(sql, params || []); }
async function b(items, options) {
  try {
    if (!ctx.api.executeSqlBatch) throw new Error('脚本 API 不支持 executeSqlBatch');
    const statements = (Array.isArray(items) ? items : [])
      .map(item => Array.isArray(item) ? renderSqlWithParams(item[0], item[1] || []) : String(item || ''))
      .map(text => text.trim())
      .filter(Boolean);
    if (!statements.length) return { success: true, changes: 0, errors: [], appliedEdits: 0, modifiedKeys: [] };
    const result = await ctx.api.executeSqlBatch(statements.join(';\n'), options || {});
    if (!result?.success || result?.errors?.length) throw new Error((result?.errors || [result?.error || 'executeSqlBatch failed']).join('; '));
    return result;
  } catch (error) {
    const firstItem = Array.isArray(items) ? items[0] : null;
    const firstSql = Array.isArray(firstItem) ? firstItem[0] : firstItem;
    const detail = { sqlName: sqlName(firstSql), count: Array.isArray(items) ? items.length : 0, error: String(error?.message || error) };
    try { if (tableExists('we_ledger') && ctx.api.executeSqlBatch) await ctx.api.executeSqlBatch(renderSqlWithParams("INSERT INTO we_ledger (request_id,round,status,prompt_digest,parsed_json,started_at,finished_at,error) VALUES (?,?,?,?,?,?,?,?)", ['sql_error_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), Number(first('SELECT round FROM we_meta LIMIT 1')?.round || 0), 'failed', 'SQL batch failed', safeJson(detail, {}), nowText(), nowText(), detail.error])); } catch (_) {}
    ctx.log.error('[World SQL] mutation 失败: ' + safeJson(detail, {}));
    throw error;
  }
}
function rows(result) { return result && Array.isArray(result.rows) ? result.rows : []; }
function first(sql, params) { return rows(q(sql, params))[0] || null; }
function tableExists(name) { return !!first("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]); }
`;

const strictJsonHelpersSource = String.raw`
function parseStrictJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('World 推演响应为空');
  if (!raw.startsWith('{') || !raw.endsWith('}')) throw new Error('World 推演响应不是严格 JSON 对象，疑似包含自由文本或 Markdown 包裹');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('World 推演响应根节点必须是 JSON 对象');
  return parsed;
}
`;

const scriptCallHelpersSource = String.raw`
function scriptRawName(name) { return String(name || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
async function runWorldScriptByName(scriptName, input) {
  if (!ctx.api.runScriptVariable) throw new Error('脚本 API 不支持 runScriptVariable: ' + scriptName);
  const response = await ctx.api.runScriptVariable({ raw: '{[script "' + scriptRawName(scriptName) + '"]}', kind: 'execute', scriptName, input: input || {} }, { sourceContext: { ...(ctx.source || {}), callerScript: ctx.hook || ctx.callType || 'world_script' } });
  if (!response?.success) throw new Error('调用脚本失败: ' + scriptName + ': ' + String(response?.error || 'unknown'));
  if (!response.result?.success) throw new Error('调用脚本失败: ' + scriptName + ': ' + String(response.result?.error || 'unknown'));
  return response.result.value;
}
`;

const identityHelpersSource = String.raw`
function stableHash(text) {
  const value = String(text || '');
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function getCurrentChatIdentity() {
  const candidates = [
    ctx.tavern?.chatId,
    ctx.event?.chatId,
    ctx.tavern?.chat_id,
    ctx.event?.chat_id,
    ctx.tavern?.chatFile,
    ctx.event?.chatFile,
    ctx.tavern?.chatName,
    ctx.event?.chatName,
  ].map(value => String(value || '').trim()).filter(Boolean);
  return candidates[0] || '';
}
function generateWorldId(meta) {
  const explicit = String(ctx.config?.worldId || ctx.input?.worldId || '').trim();
  if (explicit) return { worldId: explicit, source: 'config_override', chatIdentity: getCurrentChatIdentity() };
  const chatIdentity = getCurrentChatIdentity();
  if (chatIdentity) return { worldId: 'world_chat_' + stableHash(chatIdentity), source: 'chat_identity', chatIdentity };
  const existed = String(meta?.world_id || '').trim();
  if (existed) return { worldId: existed, source: 'existing_local', chatIdentity: '' };
  const seed = [Date.now(), Math.random().toString(36).slice(2, 10), ctx.event?.requestId || ctx.event?.messageId || 'local'].join(':');
  return { worldId: 'world_local_' + stableHash(seed), source: 'local_generated', chatIdentity: '' };
}
function worldIdNeedsRefresh(meta, generated) {
  const current = String(meta?.world_id || '').trim();
  if (!current) return true;
  if (generated.source !== 'chat_identity') return false;
  if (current === generated.worldId) return false;
  return current.startsWith('world_local_') || current.startsWith('world_chat_') || current.startsWith('world_') || current === 'default';
}
`;

const diagnosticHelpersSource = String.raw`
async function writeDiagnostic(kind, detail, round) {
  if (!tableExists('we_ledger')) return;
  await m("INSERT INTO we_ledger (request_id,round,status,prompt_digest,parsed_json,started_at,finished_at) VALUES (?,?,?,?,?,?,?)", ['diag_' + kind + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), Number(round || 0), 'success', 'World 诊断: ' + kind, safeJson(detail, {}), nowText(), nowText()]);
}
`;

const snapshotHelpersSource = String.raw`
async function restoreWorldSnapshotFromCheckpoint(checkpointId, reason) {
  const checkpoint = first('SELECT * FROM we_checkpoints WHERE checkpoint_id=?', [checkpointId]);
  const snapshot = parseJson(checkpoint?.snapshot_json, null);
  validateWorldSnapshot(snapshot);
  await restoreWorldSnapshotRows(snapshot);
  await writeDiagnostic('strict_checkpoint_rollback', { checkpointId, reason }, checkpoint?.round || 0);
}
function buildWorldSnapshot() {
  const enabledModules = rows(q("SELECT module_id,state_table FROM we_modules WHERE enabled='是'"));
  const stateTables = new Set(['we_meta','we_modules','we_prompt_templates','we_world_digest','we_custom_state']);
  for (const mod of enabledModules) if (mod.state_table && WE_TABLES.includes(mod.state_table)) stateTables.add(mod.state_table);
  const builtinStateTables = ['we_events','we_factions','we_winds','we_reputation','we_economy','we_enemies','we_influence_chain','we_blackbox','we_regional_incident'];
  for (const table of builtinStateTables) if (tableExists(table)) stateTables.add(table);
  const snapshot = {};
  for (const table of stateTables) {
    if (!tableExists(table)) continue;
    if (table === 'we_world_digest') snapshot[table] = rows(q('SELECT * FROM we_world_digest ORDER BY round DESC LIMIT 10')).reverse();
    else snapshot[table] = rows(q('SELECT * FROM ' + table));
  }
  return snapshot;
}
function validateWorldSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('snapshot_json 无效');
  for (const table of ['we_meta','we_world_digest','we_modules']) {
    if (!Array.isArray(snapshot[table])) throw new Error('snapshot_json 缺少必要表: ' + table);
  }
  for (const table of Object.keys(snapshot)) {
    if (!WE_TABLES.includes(table)) throw new Error('snapshot_json 包含未知表: ' + table);
    if (!tableExists(table)) throw new Error('目标表不存在: ' + table);
    if (!Array.isArray(snapshot[table])) throw new Error('snapshot_json 表数据不是数组: ' + table);
  }
}
async function restoreWorldSnapshotRows(snapshot) {
  validateWorldSnapshot(snapshot);
  const restoreTables = Object.keys(snapshot).filter(table => WE_TABLES.includes(table) && table !== 'we_ledger' && table !== 'we_checkpoints');
  const statements = [];
  for (const table of restoreTables) statements.push('DELETE FROM ' + table);
  for (const table of restoreTables) {
    for (const row of snapshot[table] || []) {
      const columns = Object.keys(row).filter(k => row[k] !== undefined);
      if (!columns.length) continue;
      statements.push('INSERT INTO ' + table + ' (' + columns.join(',') + ') VALUES (' + columns.map(k => sqlLiteral(row[k])).join(',') + ')');
    }
  }
  const result = await ctx.api.executeSqlBatch(statements.join(';\n'), { skipNotify: true });
  if (!result?.success) throw new Error('executeSqlBatch restore failed: ' + String(result?.errors?.join('; ') || 'unknown'));
}
`;

const insertHelpersSource = String.raw`
async function insertIfMissing(table, keyColumn, keyValue, columns, values) {
  const existed = first('SELECT row_id FROM ' + table + ' WHERE ' + keyColumn + '=? LIMIT 1', [keyValue]);
  if (existed) return false;
  const placeholders = columns.map(() => '?').join(',');
  await m('INSERT INTO ' + table + ' (' + columns.join(',') + ') VALUES (' + placeholders + ')', values);
  return true;
}
function insertIfMissingSql(table, keyColumn, keyValue, columns, values) {
  return 'INSERT INTO ' + table + ' (' + columns.join(',') + ') SELECT ' + values.map(sqlLiteral).join(',') + ' WHERE NOT EXISTS (SELECT 1 FROM ' + table + ' WHERE ' + keyColumn + '=' + sqlLiteral(keyValue) + ' LIMIT 1)';
}
function insertSql(table, columns, values) {
  return 'INSERT INTO ' + table + ' (' + columns.join(',') + ') VALUES (' + values.map(sqlLiteral).join(',') + ')';
}
function updateSql(table, assignments, whereSql) {
  return 'UPDATE ' + table + ' SET ' + assignments.join(', ') + (whereSql ? ' WHERE ' + whereSql : '');
}
`;

const messageHelpersSource = String.raw`
function normalizeMessageId() {
  return String(ctx.event?.messageId || ctx.event?.message_id || ctx.event?.floorId || ctx.event?.floor || ctx.event?.requestId || '').trim();
}
function hashText(text) { return stableHash(String(text || '')); }
function stableMessageId() {
  const direct = normalizeMessageId();
  if (direct) return { messageId: direct, degraded: false, reason: 'direct' };
  const response = String(ctx.event?.aiResponse || ctx.event?.response || '');
  const floor = String(ctx.event?.floorId || ctx.event?.floor || ctx.event?.messageIndex || ctx.event?.index || '').trim() || 'unknown_floor';
  const bucket = Math.floor(Date.now() / 300000);
  return { messageId: 'degraded_' + floor + '_' + hashText(response).slice(0, 10) + '_' + bucket, degraded: true, reason: 'floor_response_hash_time_bucket', floor, responseHash: hashText(response).slice(0, 10), timeBucket: bucket };
}
`;

const textHelpersSource = String.raw`
function compact(text, limit) {
  const value = String(text || '').trim();
  return value.length > limit ? value.slice(0, limit) + '...' : value;
}
`;

const mechanicsHelpersSource = String.raw`
function diceConditionMet(record, config) {
  const condition = config?.condition || config?.triggerCondition || {};
  if (!condition || typeof condition !== 'object') return true;
  for (const [field, expected] of Object.entries(condition)) {
    if (record[field] == null) return false;
    if (Array.isArray(expected) && !expected.includes(record[field])) return false;
    if (!Array.isArray(expected) && String(record[field]) !== String(expected)) return false;
  }
  return true;
}
function diceHit(config) {
  const chance = Number(config?.chance ?? config?.probability ?? 0);
  if (chance <= 0) return false;
  const normalized = chance <= 1 ? chance * 100 : chance;
  return Math.random() * 100 < normalized;
}
function nextStageValue(currentStage, progress, stageConfig) {
  const states = Array.isArray(stageConfig?.states) && stageConfig.states.length ? stageConfig.states : ['seed','active','resolved'];
  const terminalState = String(stageConfig?.terminalState || states[states.length - 1] || 'resolved');
  const threshold = Number(stageConfig?.progressThreshold || stageConfig?.terminalProgress || 100);
  if (Number(progress || 0) >= threshold) return terminalState;
  const index = states.indexOf(currentStage);
  if (index < 0) return states[0];
  const perStage = Math.max(1, Math.floor(threshold / Math.max(1, states.length - 1)));
  return states[Math.min(states.length - 1, Math.floor(Number(progress || 0) / perStage))] || currentStage;
}
async function applyLifecycleLimits(modules, round, preview) {
  const safeTables = new Set(WE_TABLES.filter(t => !['we_meta','we_ledger','we_checkpoints'].includes(t)));
  const statements = [];
  for (const mod of modules) {
    const lifecycle = parseJson(mod.lifecycle_json, {});
    const maxRows = Number(lifecycle?.maxRows || lifecycle?.limit || 0);
    const table = String(mod.state_table || '').trim();
    if (maxRows > 0 && safeTables.has(table) && tableExists(table)) {
      statements.push(['DELETE FROM ' + table + ' WHERE row_id NOT IN (SELECT row_id FROM ' + table + ' ORDER BY updated_round DESC, row_id DESC LIMIT ?)', [maxRows]]);
      preview.push({ table, action: 'lifecycle_max_rows', maxRows, module_id: mod.module_id });
    }
  }
  if (statements.length) await b(statements);
}
function previewWorldMechanics(round, source) {
  const modules = rows(q("SELECT module_id,state_table,mechanics_json,lifecycle_json,merge_strategy FROM we_modules WHERE enabled='是'"));
  const moduleConfig = Object.fromEntries(modules.map(m => [m.module_id, { mechanics: parseJson(m.mechanics_json, {}), lifecycle: parseJson(m.lifecycle_json, {}) }]));
  const stageConfig = moduleConfig.events?.mechanics?.stage || { progressField: 'progress', stageField: 'stage', terminalField: 'terminal', progressStep: 5, progressThreshold: 100, terminalState: 'resolved' };
  const diceConfig = moduleConfig.regional_incident?.mechanics?.dice || { chance: 10, cooldown: 5, duration: 3 };
  const lifecycleLimits = modules.map(m => ({ module_id: m.module_id, state_table: m.state_table, lifecycle: parseJson(m.lifecycle_json, {}) })).filter(item => Number(item.lifecycle?.maxRows || item.lifecycle?.limit || 0) > 0);
  return { source: source || 'preview', round, modules: modules.length, stageConfig, diceConfig, lifecycleLimits };
}
async function runWorldMechanics(round, source) {
  const modules = rows(q("SELECT module_id,state_table,mechanics_json,lifecycle_json,merge_strategy FROM we_modules WHERE enabled='是'"));
  const preview = [];
  const moduleConfig = Object.fromEntries(modules.map(m => [m.module_id, { mechanics: parseJson(m.mechanics_json, {}), lifecycle: parseJson(m.lifecycle_json, {}) }]));
  await b([
    ["UPDATE we_winds SET decay_rounds = MAX(decay_rounds - 1, 0), updated_round=? WHERE decay_rounds > 0", [round]],
    ["DELETE FROM we_winds WHERE decay_rounds <= 0 AND visible_to_user='否'"],
    ["UPDATE we_regional_incident SET remaining_rounds=MAX(remaining_rounds-1,0), cooldown=MAX(cooldown-1,0), updated_round=? WHERE active='是' OR cooldown > 0", [round]],
    ["DELETE FROM we_influence_chain WHERE status IN ('expired','settled') OR (expires_round IS NOT NULL AND expires_round < ?)", [round]],
    ["DELETE FROM we_events WHERE terminal='是' OR (expires_round IS NOT NULL AND expires_round < ?)", [round]],
    ["DELETE FROM we_economy WHERE expires_round IS NOT NULL AND expires_round < ?", [round]],
    ["DELETE FROM we_custom_state WHERE expires_round IS NOT NULL AND expires_round < ?", [round]],
  ]);
  preview.push({ table: 'we_winds', action: 'decay_rounds_decrement' });
  preview.push({ table: 'we_winds', action: 'delete_invisible_expired' });
  preview.push({ table: 'we_regional_incident', action: 'duration_and_cooldown_decrement' });
  preview.push({ table: 'lifecycle', action: 'expires_round_terminal_status_cleanup' });
  await applyLifecycleLimits(modules, round, preview);
  const stageConfig = moduleConfig.events?.mechanics?.stage || { progressField: 'progress', stageField: 'stage', terminalField: 'terminal', progressStep: 5, progressThreshold: 100, terminalState: 'resolved' };
  const stageRows = rows(q("SELECT row_id, stage, progress, terminal FROM we_events WHERE terminal='否' AND progress < ?", [Number(stageConfig.progressThreshold || stageConfig.terminalProgress || 100)]));
  const stageStatements = [];
  for (const item of stageRows) {
    const nextProgress = Math.min(Number(item.progress || 0) + Number(stageConfig.progressStep || 5), Number(stageConfig.progressThreshold || stageConfig.terminalProgress || 100));
    const nextStage = nextStageValue(item.stage, nextProgress, stageConfig);
    const terminal = nextStage === String(stageConfig.terminalState || 'resolved') || nextProgress >= Number(stageConfig.progressThreshold || stageConfig.terminalProgress || 100) ? '是' : '否';
    stageStatements.push(['UPDATE we_events SET progress=?, stage=?, terminal=?, updated_round=? WHERE row_id=?', [nextProgress, nextStage, terminal, round, item.row_id]]);
  }
  if (stageStatements.length) await b(stageStatements);
  preview.push({ table: 'we_events', action: 'stage_progress', config: stageConfig, count: stageRows.length });
  const customStageConfig = moduleConfig.trends?.mechanics?.stage || { progressStep: 1 };
  await b([
    ["UPDATE we_custom_state SET score=MIN(COALESCE(score,0)+?,100), updated_round=? WHERE stage IS NOT NULL AND (expires_round IS NULL OR expires_round >= ?)", [Number(customStageConfig.progressStep || 1), round, round]],
    ["UPDATE we_blackbox SET exposure_risk=MIN(exposure_risk + CASE WHEN COALESCE(traces,'')<>'' OR COALESCE(witnesses,'')<>'' THEN ? ELSE 0 END, 100), public_status=CASE WHEN exposure_risk >= 100 AND (COALESCE(traces,'')<>'' OR COALESCE(witnesses,'')<>'') THEN 'exposed' WHEN exposure_risk >= 80 AND (COALESCE(traces,'')<>'' OR COALESCE(witnesses,'')<>'') THEN 'leaking' ELSE public_status END, updated_round=? WHERE public_status <> 'exposed'", [Number(moduleConfig.blackbox?.mechanics?.exposureStep || 5), round]],
  ]);
  preview.push({ table: 'we_custom_state', action: 'custom_stage_progress', config: customStageConfig });
  preview.push({ table: 'we_blackbox', action: 'exposure_progress_requires_trace_or_witness' });
  const incidents = rows(q("SELECT * FROM we_regional_incident WHERE active='否' AND cooldown=0 LIMIT 10"));
  const diceConfig = moduleConfig.regional_incident?.mechanics?.dice || { chance: 10, cooldown: 5, duration: 3 };
  const incidentStatements = [];
  for (const incident of incidents) {
    if (diceConditionMet(incident, diceConfig) && diceHit(diceConfig)) {
      incidentStatements.push(["UPDATE we_regional_incident SET active='是', remaining_rounds=CASE WHEN remaining_rounds > 0 THEN remaining_rounds ELSE ? END, cooldown=?, updated_round=? WHERE row_id=?", [Number(diceConfig.duration || diceConfig.remaining_rounds || 3), Number(diceConfig.cooldown || 5), round, incident.row_id]]);
      preview.push({ table: 'we_regional_incident', action: 'dice_trigger', incident_key: incident.incident_key, config: diceConfig });
    }
  }
  if (incidentStatements.length) await b(incidentStatements);
  await writeDiagnostic('mechanics_preview', { source: source || 'shared', preview }, round);
  return { ok: true, round, mechanics: { modules: modules.length, preview } };
}
`;

const WORLD_HELPERS_LIBRARY_NAME = 'World 公共方法库';
const worldHelpersLibrarySource = `export function install(ctx) {\n${coreHelpersSource}\n${strictJsonHelpersSource}\n${scriptCallHelpersSource}\n${identityHelpersSource}\n${diagnosticHelpersSource}\n${snapshotHelpersSource}\n${insertHelpersSource}\n${messageHelpersSource}\n${textHelpersSource}\n${mechanicsHelpersSource}\nreturn { WE_TABLES, nowText, safeJson, parseJson, q, sqlName, s, m, b, rows, first, tableExists, parseStrictJsonObject, scriptRawName, runWorldScriptByName, stableHash, getCurrentChatIdentity, generateWorldId, worldIdNeedsRefresh, writeDiagnostic, restoreWorldSnapshotFromCheckpoint, buildWorldSnapshot, validateWorldSnapshot, restoreWorldSnapshotRows, sqlLiteral, insertIfMissing, insertIfMissingSql, insertSql, updateSql, normalizeMessageId, hashText, stableMessageId, compact, diceConditionMet, diceHit, nextStageValue, applyLifecycleLimits, previewWorldMechanics, runWorldMechanics };\n}`;

function importWorldHelpers(names) {
  return `const { ${names.join(', ')} } = (await ctx.importLibrary('${WORLD_HELPERS_LIBRARY_NAME}')).install(ctx);\n`;
}

const initializerSource = importWorldHelpers(['WE_TABLES','nowText','tableExists','first','m','b','insertIfMissing','insertIfMissingSql','generateWorldId','worldIdNeedsRefresh','stableHash','writeDiagnostic']) + String.raw`
async function main() {
  try {
    const missing = WE_TABLES.filter(name => !tableExists(name));
    if (missing.length) {
      ctx.log.warn('[World 初始化器] 缺少 World 表，请先导入 World数据库模板: ' + missing.join(', '));
      return { ok: false, missing };
    }
    const generatedForInsert = generateWorldId(null);
    const worldId = generatedForInsert.worldId;
    await insertIfMissing('we_meta', 'world_id', worldId,
      ['world_id','mode','active_preset','round','enabled','evolve_every','updated_at'],
      [worldId,'classic','default',0,'是',1,nowText()]
    );
    const meta = first('SELECT * FROM we_meta LIMIT 1');
    const generated = generateWorldId(meta);
    if (meta && worldIdNeedsRefresh(meta, generated)) {
      const previousWorldId = String(meta.world_id || '').trim();
      await m('UPDATE we_meta SET world_id=?, updated_at=? WHERE row_id=?', [generated.worldId, nowText(), meta.row_id]);
      await writeDiagnostic('world_id_refresh', { previousWorldId, worldId: generated.worldId, source: generated.source, chatIdentityHash: generated.chatIdentity ? stableHash(generated.chatIdentity) : '' }, meta.round);
      ctx.log.warn('[World 初始化器] 已按当前聊天修复 world_id: ' + (previousWorldId || '<empty>') + ' -> ' + generated.worldId);
    }
  const modules = [
    ['world','世界运转','builtin','是','none',null,null,10,"<world_engine>\n世界是活的。不在{{user}}视线内的人也在过自己的生活。\n\n一、核心原则（世界非中心化）\n本世界是一个独立运转的生态系统，{{user}}只是其中的一个参与者，而非世界的中心。\n- NPC有自己的生活目标、日程、社交圈和情感，不会无缘无故围绕{{user}}转。\n- 事件链、风声、团体进度等即使与{{user}}无关，也会自动推进。\n- 持续中的天下大势是每轮推演都必须考虑的世界级约束。\n- AI在生成剧情时，应优先考虑世界的独立运转（后台推演），其次才是{{user}}的参与和感知。\n- {{user}}可以通过面板看到世界的全貌（玩家全知），但主角本人只能感知到与他相关或他恰好遇到的部分。\n- 禁止默认\"所有事情都与{{user}}有关\"。与{{user}}无关的事件是世界的常态，不是例外。\n\n二、感知覆盖\n- 直接接触层：{{user}}当前所在空间、目光所及、正在对话的人。\n- 近距离层：同一建筑/社区/组织的其他区域，日常经过的地方。\n- 远距离层：整个城市/区域/组织体系，间接影响{{user}}的人和事。\n每次输出正文时，直接接触层写进正文，近距离层和远距离层写在面板中。\n远距离层的事件主要通过风声和事件链爆发来影响直接接触层，除非{{user}}拥有特殊通讯手段。\n\n三、轮次推进\n每次输出代表一轮对话。每轮对话，后台世界自动向前推进一步（与剧情内具体时长无关）。\n- 未在场人物按自己的日程执行活动。\n- 事件链按骰子系统驱动进度（详见模块二：事件链）。\n- 风声通过合法传播节点扩散；公告和消息通常保持稳定，流言可能夸张或扭曲，舆情可能随新信息转向。\n- 团体进度、凝聚力、经济状况等自然波动。\n轮次推进的结果必须在面板的世界摘要中体现。\n\n四、地域与势力具名\n涉及地理位置或势力范围时，必须使用具体名称，不得用\"全城\"\"全国\"\"某势力\"等模糊词。\n- 若世界观已预设城市/国家/势力名，则沿用（如\"帝都长安\"、\"北境王国\"）。\n- 若未预设，AI应自行创造合理名称并保持前后一致，且符合世界背景。\n- 风声的传播范围、事件链的影响区域、远距离层的描述均须遵守此规则。\n\n五、时间与季节（可选）\nAI可根据剧情自然推断季节，在面板世界摘要或经济摘要中体现季节影响（春耕复苏/夏炎户外少/秋收降价/冬寒燃料涨等）。事件须匹配当前季节与地区氛围。\n</world_engine>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。",'{}','{}','{}','{}','ignore'],
    ['events','事件链','builtin','是','array','we_events','event_key',20,"<event_chain>\n\n一、双类型事件链\n\n事件链分为两类：冲突型（conflict）与推进型（progress）。事件 event_type 一旦确定不得改动；同名事件后续更新必须沿用原 event_type。若需要从研发引发冲突，或从冲突引出善后工程，应新建另一条事件链，并在影响链中记录两者的传导关系。\n\n1. 冲突型（conflict）— 用于报复、通缉、派系摩擦、追杀、战争、清算等会滚向爆发的矛盾链。\n正常推进顺序固定为：萌芽 → 发酵 → 逼近 → 已爆发。\n  - 萌芽：冲突刚出现苗头，只有少数人察觉，尚未形成公开压力。\n  - 发酵：矛盾开始扩散，组织、人手、传闻或报复动机正在聚集。\n  - 逼近：冲突即将落到具体行动或直接影响，已经接近爆发点。\n  - 已爆发：冲突结果落地，追杀、通缉、械斗、封锁、清算等已经发生。\n  - 已消散：冲突失去动机、执行者、资源、目标或时效，已经确定不会继续爆发。不是正常推进阶段，只能由AI根据明确因果直接判定。\n冲突型 level 表示冲突烈度和失控势能，Lv 越高越容易推进。\n\n2. 推进型（progress）— 用于研发、建设、训练、调查、派人办事、商路开辟、资源筹措、制度改革等会滚向完成的事务链。\n正常推进顺序固定为：筹备 → 执行 → 关键 → 已完成。\n  - 筹备：资源、人手、材料、情报、路线或计划正在准备，尚未全面展开。\n  - 执行：事项已经实际开始，有持续投入、行动痕迹和阶段性消耗。\n  - 关键：接近结果，最容易被干扰、截胡、反转、延期或付出代价。\n  - 已完成：成果落地并进入世界状态，可能生成后续事件、风声、经济或势力变化。\n  - 已失败：事项因执行者退出、资源耗尽、关键条件永久丧失、被有效反制或时效过期而确定无法完成。不是正常推进阶段，只能由AI根据明确因果直接判定。\n推进型 level 表示完成难度与影响规模，Lv 越高越难推进。\n\n二、推进机制（本地骰子 + API 双重驱动）\n\n每条事件链使用 progress: 0-100 表示阶段内进度，达到阶段阈值时晋级到下一阶段。\n- 本地系统每轮先掷骰给出一个基线推进（正常推进、受挫倒退或保持），并负责终局晋级（已爆发/已完成）。调用本规则时，传入的 stage 与 progress 已经是本轮骰子推进后的值，本地机制会在状态中体现本轮基线推进结果。\n- 在此基线之上，你（API）有权根据当前世界状态、本轮对话与因果逻辑，自行决断事件进程：可以沿用骰子结果，也可以改写 stage 与 progress（以你返回的值为准），让进程符合剧情真实走向。骰子负责防止事件停滞，你负责保证进程合理。\n- 所有终局都可由你根据明确因果直接判定，包括正面终局「已爆发」（冲突型）/「已完成」（推进型）——剧情已经走到爆发或完成时，你可以直接给出，不必等骰子一格格爬。\n- 其中「已消散」（冲突型）与「已失败」（推进型）两个负面终局只能由你判定，骰子永远不会自动给出。\n\n三、事件链分级\n\n【冲突型事项分级】\n- Lv.1 个人摩擦：口角、普通斗殴、小额偷窃。演化上限：当事人及直接上级/亲属报复。极值后果：挨打、赔钱。\n- Lv.2 局部冲突：重伤他人、砸毁店铺、公然羞辱。演化上限：所在街区或单一普通团体。极值后果：区域悬赏、帮派追击。\n- Lv.3 区域震荡：杀死核心人物、屠杀平民、炸毁设施。演化上限：整个城市或多个顶级势力。极值后果：全城通缉、不死不休。\n- Lv.4 世界危机：刺杀君主、引发灭城。演化上限：无限制。\n\n【推进型事项分级】\n- Lv.1 个人/小规模事项：单人或少数人能完成，资源需求低。例：打探普通消息、修补装备、配一副常见药、派人送信、招募临时帮手。\n- Lv.2 局部事务：需要稳定人手、材料、路线或小型组织配合。例：建立临时据点、研发改良配方、训练小队、安排潜入、打通短程货路。\n- Lv.3 区域级计划：需要多个组织、关键人物或稀缺资源协同。例：建造大型工坊、研发军用技术、策反关键人物、部署区域情报网、迁移大批物资。\n- Lv.4 世界/政权级工程：超大规模、长期、跨区域或改变权力结构的计划。例：铸造镇国神器、建立新政权制度、重构大陆商路、研发颠覆性技术、大规模移民筑城。\n推进型 level 表示完成难度与影响规模，不表示危险烈度。Lv越高，推进越慢、阻力越大。\n\n四、特权修正法则\n\n当受害者的地位/权力高于{{user}}时，事件的实际定级发生\"特权跃升\"：\n- 若受害者为【核心人物/特权阶级/朝堂高层】：所有Lv.1行为自动跃升为Lv.2（如：顶撞权贵=重罪）；Lv.2行为自动跃升为Lv.3（如：打伤权贵=全城通缉）。\n- 若受害者为【顶级势力领袖/皇室】：任何冒犯起步即为Lv.3甚至Lv.4。\n- 反之，若{{user}}权力地位远高于受害者，事件级别可被权力强行压低。\n\n五、消散、失败与停滞\n\n事件链不是命运。事件链可以停滞，也可以走向负面终局。AI不得为推进事件链而违反世界规则或势力平衡。\n\n【停滞与负面终局的区别】\n- 停滞：当前无法推进，但仍存在合理恢复条件。设置 stall=true，保持当前 stage，并在current_state中写明恢复条件。\n- 已消散：冲突已永久失去动机、执行者、资源、目标或时效。直接设置 stage=\"已消散\"。\n- 已失败：事项已永久失去完成条件或目标已不可达成。直接设置 stage=\"已失败\"。\n- 仅仅连续多轮没有进展，不足以判定已消散或已失败。\n- 已爆发、已消散、已完成、已失败均为终局，进入后不得恢复为非终局阶段；如需重新开始，必须创建新事件链。\n\n【消散/失败/停滞判断条件（满足任一）】\n1. 物理阻断：执行方无法物理到达目标\n2. 能力不足：执行方实力/资源不足以完成当前阶段\n3. 信息断裂：执行方丢失目标踪迹且无合法途径重新获取（受信息传播铁律约束）\n4. 资源耗尽：执行方资源枯竭，无力继续\n5. 被反制：{{user}}或第三方成功实施有效反制\n6. 时间过期：事件链有时效性，超时自然消亡\n\n六、势力等级与渗透\n\n判断\"追杀方能否到达目标所在地\"：\n追杀方势力 < 目标所在地保护势力 → 无法渗透，事件链停滞\n追杀方势力 = 目标所在地保护势力 → 困难渗透，需多轮准备+合理手段\n追杀方势力 > 目标所在地保护势力 → 可渗透\n势力等级由资源储备、武力规模、情报覆盖、政治地位综合判定。\n\n禁止事项：\n- 禁止为推进事件链让弱势力凭空获得强势力能力\n- 禁止让追杀者无视环境危险\n- 禁止在强势力核心区凭空生成大量间谍/刺客（除非已有内鬼伏笔）\n- 禁止\"因为是血仇所以什么都能做到\"——血仇提供动机，不提供能力\n\n【停滞期间的替代行为】\n事件链停滞≠放弃，执行方转入低烈度状态：在外围布置眼线、积攒资源、寻找盟友/雇佣更强力量、等待目标离开保护区。标注为\"停滞-外围准备\"，给出恢复条件。\n\n【与仇敌录联动】\n仇敌事件链同样受本节约束。仇敌锁定的是仇恨永不淡化和动机永不消失，不等于追杀方获得无限能力。仇敌方在停滞期间会持续寻求更强手段，但必须通过合法途径（雇佣、结盟、积累）逐步升级，每一步都需要在事件链中体现。\n</event_chain>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。","{\"moduleId\":\"events\",\"field\":\"events\",\"container\":\"array\",\"description\":\"事件链数组。只返回本轮有推进、停滞、转向、结束或新建的事件。输出字段直接对应 we_events。\",\"fields\":{\"event_key\":{\"type\":\"string\",\"description\":\"稳定事件键；同一事件必须沿用，用于更新既有记录。\"},\"title\":{\"type\":\"string\",\"description\":\"事件标题，对应原 name。\"},\"event_type\":{\"type\":\"enum\",\"description\":\"conflict/progress/custom。conflict=冲突型，progress=推进型；新事件必须明确。\"},\"stage\":{\"type\":\"string\",\"description\":\"当前阶段。conflict 使用 萌芽/发酵/逼近/已爆发/已消散；progress 使用 筹备/执行/关键/已完成/已失败。\"},\"progress\":{\"type\":\"number\",\"description\":\"0-100 的阶段进度。\"},\"scope\":{\"type\":\"string\",\"description\":\"事件影响范围。\"},\"actors\":{\"type\":\"array|string\",\"description\":\"参与方或行动者 JSON/短文本。\"},\"cause\":{\"type\":\"string\",\"description\":\"起因。\"},\"current_state\":{\"type\":\"string\",\"description\":\"本轮事件变化说明。\"},\"next_pressure\":{\"type\":\"string\",\"description\":\"后续压力、恢复条件或下一步风险。\"},\"visibility\":{\"type\":\"enum\",\"description\":\"public/rumor/private/unknown。\"},\"terminal\":{\"type\":\"enum\",\"description\":\"是/否；已爆发、已消散、已完成、已失败通常为 是。\"},\"expires_round\":{\"type\":\"number\",\"description\":\"可选，过期轮次。\"}}}",JSON.stringify({ stage: { progressField: 'progress', stageField: 'stage', terminalField: 'terminal', progressStep: 11, progressThreshold: 100, terminalState: '已完成' } }),'{}',JSON.stringify({ maxRows: 50 }),'upsert'],
    ['factions','势力','builtin','是','array','we_factions','faction_key',30,"<factions>\n\n一、群体识别（强制）\n至少识别并维护3个群体。每个群体必须有：名称、维护物、排斥物、攻击性、内部权力结构、信息网络。\n\n二、群体行为逻辑\n触发→传播→讨论→决策→行动。\n\n三、{{user}}与群体关系演变\n- 符合维护物 → 拉拢。\n- 触碰维护物 → 敌意。\n- 符合排斥物 → 排挤。\n- 表现价值 → 私下接触。\n- 选边站 → 得一方失另一方。\n\n四、群体并非铁板一块\n内部应有不同声音和派系。核心人物的个人目的可与团体整体目标不一致，甚至相悖。\n\n五、势力字段（每轮输出）\n每轮按以下字段描述各势力：\n- faction_key：稳定势力键（同一势力沿用）\n- name：势力名称\n- scope：势力直接控制或具有重大影响力的地理范围\n- status：整体运势——\"鼎盛\"/\"稳固\"/\"倾轧\"/\"困顿\"/\"衰落\"/\"瓦解\"。\n  鼎盛=有钱有人有势，内部铁板一块。稳固=正常运行无重大危机。倾轧=内部有派系斗争或核心人物不和，但架子还没散。困顿=资源枯竭或被外部封锁，正在咬牙硬撑。衰落=失去支柱/地盘/核心人物，滑向瓦解。瓦解=只差终局确认，已名存实亡。\n- relation_to_user：该势力对{{user}}的态度，七级（以\"中立\"为正中）——\"血盟\"/\"盟友\"/\"友好\"/\"中立\"/\"冷淡\"/\"敌对\"/\"世仇\"。\n  血盟=绝对信任，生死与共；盟友=地位平等，互相支援；友好=认同{{user}}，优先合作；中立=不关心不排斥；冷淡=已注意到但不打算采取行动；敌对=公开对抗；世仇=不死不休。\n- goal：当前目标文字\n- core_people：核心人物姓名\n- resources：该势力当前拥有的权力支柱，最多3个，每个为1-4字的名称字符串（如\"武力威慑\"/\"官场人脉\"/\"财政支持\"/\"民众拥护\"等）。只有稳固有效、有实际力量的支柱才列入；已崩溃或失效的支柱不得保留。\n※ 若为临时组建的亲属复仇团体，core_people 写\"无（牵头人：XXX）\"。\n\n【轮次推进默认变化】若无重大事件，团体进度和凝聚力每轮应有微小波动，变化原因可写\"自然波动\"或\"内部日常运作\"。这些默认变化必须在面板世界摘要中体现。\n\n六、势力之间的关系\n用固定词表描述势力间的关系状态，仅限使用以下7个层级词：血盟、盟友、友好、中立、冷淡、敌对、世仇。禁用层级外模糊词。\n关系演变：共同行动→关系改善；冲突→关系恶化；{{user}}调解或挑拨→可改变关系。\n关系影响：盟友之间共享信息、互相支援；敌对势力可能发生公开冲突，影响事件链。\n\n七、强制介入机制\n以下情况必须强制介入：relation_to_user变为敌对或世仇；{{user}}显著影响团体进度；团体成员主动接触；经济导致势力status降为困顿或衰落时下轮必须介入。\n\n八、核心人物\n每个正式势力必须有至少1名核心掌权人物。核心人物必须是掌握实际权力或资源的人。\n- 【世界书优先】优先检索角色卡已预设的配角，若其社会地位与团体首领匹配，则直接提拔。\n- 【自行创造】若无匹配预设角色，则自行创建，赋予姓名、职务、性格特征及个人目的。\n- 【个人目的】核心人物的个人目的可与团体目标一致，也可相悖。\n- 【权力影响】核心人物掌握团体最高权力。其死亡将导致团体陷入内斗、分裂、解散，或触发仇敌事件链。\n\n九、权力支柱与权力瓦解\n每个正式团体必须声明其当前拥有的 resources，最多3个，每个为1-4字的名称字符串（如\"武力威慑\"\"官场人脉\"\"财政支持\"）。只列出当前稳固有效的支柱，已崩溃或失效的不得保留。\n支柱变化必须写入 influence_chain，说明哪个支柱因何事件被摧毁/动摇/新建立。\n{{user}}可通过事件链逐个摧毁核心人物的权力支柱。每摧毁一个支柱，其实际控制力下降，团体status 应反映此变化。\n所有支柱被摧毁后，该人物将失去权力及核心人物地位。此时若被杀死，不再触发 enemy_type=blood，仅按仇敌录模块中\"普通成员被杀\"处理（enemy_type=grudge）。\n</factions>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。","{\"moduleId\":\"factions\",\"field\":\"factions\",\"container\":\"array\",\"description\":\"势力数组。记录组织、团体、家族、门派、公司或其他可持续行动的集体。输出字段直接对应 we_factions。\",\"fields\":{\"faction_key\":{\"type\":\"string\",\"description\":\"稳定势力键；同一势力必须沿用。\"},\"name\":{\"type\":\"string\",\"description\":\"势力名称。\"},\"type\":{\"type\":\"string\",\"description\":\"势力类型。\"},\"scope\":{\"type\":\"string\",\"description\":\"势力直接控制或重大影响范围。\"},\"status\":{\"type\":\"enum\",\"description\":\"整体状态，使用当前预设词表；古风默认 鼎盛/稳固/倾轧/困顿/衰落/瓦解。\"},\"relation_to_user\":{\"type\":\"enum\",\"description\":\"对 {{user}} 态度；古风默认 血盟/盟友/友好/中立/冷淡/敌对/世仇。\"},\"goal\":{\"type\":\"string\",\"description\":\"当前目标。\"},\"resources\":{\"type\":\"array|string\",\"description\":\"资源或权力支柱。\"},\"core_people\":{\"type\":\"array|string\",\"description\":\"核心人物 JSON/短文本，对应原 core_person。\"},\"internal_conflict\":{\"type\":\"string\",\"description\":\"内部矛盾。\"},\"known_info\":{\"type\":\"string\",\"description\":\"该势力合法获知的信息，必须符合传播规则。\"},\"last_action\":{\"type\":\"string\",\"description\":\"本轮最近行动。\"}}}",'{}','{}',JSON.stringify({ maxRows: 50 }),'upsert'],
    ['winds','风声','builtin','是','array','we_winds','wind_key',40,"<winds>\n\n风声是世界中正在传播的公开说法，是事件、势力、经济、声誉与主动接触之间的信息中介。它不是客观真相记录，也不是无意义的气氛列表。\n\n一、风声结构\n- wind_key：稳定风声键（同一风声沿用）\n- topic：稳定主题名。更新同一条风声时沿用 topic，禁止重复创建近义条目。\n- channel：\"announcement\"/\"report\"/\"rumor\"/\"sentiment\"，分别表示公告、消息、流言、舆情。\n- intensity/传播规模：实际传播规模。Lv1=圈内少数人；Lv2=地方；Lv3=州郡、省份、等大区；Lv4=国家、国际、天下。\n- content：当前正在传播的具体说法。\n- scope：当前实际传播到的具体地区或圈层。\n- source：来源与传播链。与{{user}}相关时必须写完整信息链。\n\n二、生成边界\n- 有人公开发布、亲眼看到后转述、消息经渠道传递、流言开始扩散或群体形成共同态度时，才创建风声。\n- 私信、密令、秘密情报等仅有明确接收者的信息不属于风声；泄露并开始传播后才创建。\n- 禁止每轮强制生成风声，禁止用\"世界平静无大事\"等占位风声凑数。\n- 公告只证明发布者公开说过这件事，不保证内容为真；流言也可能恰好为真。风声的可信度写入 credibility，传播强度写入 intensity，但不得用它们替代来源链。\n\n三、传播与升级\n- 每轮检查已有风声是否获得新的合法传播节点。没有传播节点时，intensity/传播规模 与 scope 保持不变。\n- 连续多轮没有实质更新的风声会由本地系统判定消散，并在下一轮后台推演前直接删除。\n- 若一条风声本轮仍在传播、变质、扩大范围或持续影响世界，必须返回相同 topic 的更新；仅原样复述而没有实际变化不算更新。\n- 风声寿命与消散由本地系统管理，禁止输出或操纵内部计数。\n- 同一场景可即时传播；同一区域通常需1-2轮；跨区域通常需3-5轮；世界观内的广播、网络、法术通讯等可缩短时间。\n- intensity/传播规模 只表示传播规模，不表示事情的重要性或真假。\n- 公告和消息传播时通常保持内容稳定；流言可能夸张、扭曲或分化；舆情可因新信息转向。\n- 风声可以长期停留在原等级，但必须有持续传播或影响作为依据。\n\n四、跨系统联动（强制）\n- 风声只有传播到相关对象所在范围或圈层后，该对象才能据此行动。\n- 风声可改变势力目标、资源调度或对{{user}}关注度；可触发、推进、延缓或终结事件链；可改变声誉；可促成调查、接触、封锁、抢购等行为。\n- 重大经济 signals 应产生对应风声，公众因风声采取行动后又可反过来改变经济。\n- 与{{user}}有关的行为只有形成覆盖对应圈层的风声后，才能改变该圈层声誉。\n- 仇敌只有通过覆盖其情报来源的风声或其他合法渠道获知线索后，才能据此追踪。\n- 每当风声造成跨系统变化，必须写入 influence_chain，明确\"哪条风声 → 谁获知 → 采取何种行动或形成何种判断\"。\n- 没有实际外溢影响的风声只更新自身，禁止硬造联动。\n</winds>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。","{\"moduleId\":\"winds\",\"field\":\"winds\",\"container\":\"array\",\"description\":\"风声数组。记录正在传播的信息、谣言、公告、舆情。输出字段直接对应 we_winds。\",\"fields\":{\"wind_key\":{\"type\":\"string\",\"description\":\"稳定风声键；同一 topic 更新时沿用。\"},\"topic\":{\"type\":\"string\",\"description\":\"稳定主题名。\"},\"content\":{\"type\":\"string\",\"description\":\"当前正在传播的具体说法。\"},\"source\":{\"type\":\"string\",\"description\":\"来源与传播链；与 {{user}} 相关时必须写完整信息链。\"},\"channel\":{\"type\":\"enum|string\",\"description\":\"announcement/report/rumor/sentiment 或传播渠道。\"},\"scope\":{\"type\":\"string\",\"description\":\"实际传播到的地区或圈层。\"},\"credibility\":{\"type\":\"enum\",\"description\":\"真实/半真半假/谣言/未证实；若原规则不要求可信度，可按传播性质谨慎填写。\"},\"intensity\":{\"type\":\"number\",\"description\":\"0-10 强度；由原 level 1-4 映射，传播规模越大越高。\"},\"decay_rounds\":{\"type\":\"number\",\"description\":\"可选，剩余衰减轮次；通常省略由本地机制维护。\"},\"visible_to_user\":{\"type\":\"enum\",\"description\":\"是/否；{{user}} 所在范围可感知时为 是。\"}}}",JSON.stringify({ decay: { mode: 'decay' } }),'{}',JSON.stringify({ maxRows: 50 }),'upsert'],
    ['influence_chain','影响链','builtin','是','array','we_influence_chain','chain_key',50,"<influence_chain>\n\ninfluence_chain 用于记录重要变化在世界中的传播过程。它不是新的事件链，不参与骰子推进，不表示 stage 进度。它回答的是\"什么触发了变化、直接改变了什么、又产生了什么后续余波\"。\n\n一、可记录的影响\n- 事件链对风声、经济、声誉、势力行动、NPC接触的影响\n- 天下大势对事件链、势力行动、经济与风声的长期约束\n- 风声传播对势力判断、公众态度、官方动作的影响\n- 经济变化对资源、物价、行动能力、势力计划的影响\n- 声誉变化对不同圈层NPC态度和主动接触的影响\n- 黑盒信息泄露或未泄露对外界认知、调查方向、错误判断的影响\n- 一个事件链对另一个事件链的加速、延缓、转向、消散或失败影响\n\n二、三段结构\n每条 influence_chain 必须使用数据库字段结构：\n- chain_key：稳定影响链键\n- source_module：触发源模块\n- source_key：触发源记录键\n- evidence：触发源与因果证据\n- direct_effect：直接影响。触发源已经真实改变了什么世界状态。\n- propagated_to：传导目标；后续余波写入 evidence 或 direct_effect。\n\n三、禁止事项\n- 不得把 influence_chain 当成新的事件链创建 stage 或 progress。\n- 不得把普通事件进度流水账全部塞入 influence_chain；只有产生跨系统外溢影响时才记录。\n- direct_effect 必须是已经发生的直接变化；evidence 必须是由该影响继续扩散产生的余波，不得重复改写 evidence。\n- 不得借 influence_chain 泄露黑盒信息给不知情NPC。\n- 同一 evidence 已有记录时更新该记录，不要无限堆叠重复记录。\n</influence_chain>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。","{\"moduleId\":\"influence_chain\",\"field\":\"influence_chain\",\"container\":\"array\",\"description\":\"影响链数组。只记录真实产生外溢影响的跨系统传导。输出字段直接对应 we_influence_chain。\",\"fields\":{\"chain_key\":{\"type\":\"string\",\"description\":\"稳定影响链键；同一影响链更新时沿用。\"},\"source_module\":{\"type\":\"string\",\"description\":\"触发源模块，如 winds/events/economy。\"},\"source_key\":{\"type\":\"string\",\"description\":\"触发源记录键。\"},\"direct_effect\":{\"type\":\"string\",\"description\":\"已经发生的直接影响，对应原 impact。\"},\"propagated_to\":{\"type\":\"array|string\",\"description\":\"传导目标。\"},\"evidence\":{\"type\":\"string\",\"description\":\"因果证据。\"},\"status\":{\"type\":\"enum\",\"description\":\"active/settled/expired。\"},\"expires_round\":{\"type\":\"number\",\"description\":\"可选，过期轮次。\"}}}",'{}','{}',JSON.stringify({ maxRows: 80 }),'upsert'],
    ['contact_rules','主动接触与传播规则','builtin','是','none',null,null,60,"<contact_and_info>\n\n一、信息显现（被动感知）\n指{{user}}通过环境自然获取信息，无需与人互动。包括：听到远处的喧哗/惨叫/爆炸声、看到街边的公告/涂鸦/人群聚集、闻到烟味/血腥味、感觉到震动/温度变化、收到飞鸽传书/信使投递（非对话）。\n信息显现不消耗对话轮次，不改变NPC状态。{{user}}可以无视，也可以主动循迹调查。\n\n二、主动接触（互动）\n指NPC主动与{{user}}发生对话、肢体冲突、交易等互动。必须满足以下至少一项：\n- {{user}}的可见行为引起了特定NPC的注意（如当众露财、伤人、救人）\n- NPC的个人目的与{{user}}产生交集\n- 势力 relation_to_user 达到\"友好\"或更近、或\"敌对\"及更差\n- {{user}}声誉在该区域达到一定水平\n- {{user}}主动进入NPC的势力范围（如酒馆、商店、黑市）\n\n三、强制接触规则\n- 不设\"连续三轮无接触则强制安排\"的规则。\n- 改为：若连续五轮没有任何主动接触，且{{user}}没有刻意躲藏或远离人群，AI应在第六轮创建一个\"无聊/孤立\"类事件（如\"{{user}}感到被忽视\"、\"街上的人行色匆匆无人理会\"），作为剧情调味，而非强制接触。\n- {{user}}主动躲藏（如进入荒野、闭门不出）时，不触发普通的接触与孤立事件。\n- 【仇敌特例】主动躲藏无法完全免疫仇敌追杀。仇敌方可能通过线索追踪、买通黑市等手段破隐找上门（强制引发接触）。\n\n四、接触真实感\n接触者必须有独立生活痕迹、明确因果、符合性格、时机自然。\n禁止凭空制造接触；禁止全员为麻烦；禁止\"从找那一刻才开始\"；允许面板写NPC未来计划，但禁止正文/NPC对话提前泄露。\n\n五、信息传播铁律\nNPC没有读档能力。AI在让任何NPC/团体/黑市获知一条信息前，必须能回答\"谁告诉他的\"或\"他怎么亲眼看到的\"。答不上来，NPC就不知道。\n\n【合法获知途径（穷举）】\n1. 亲眼目睹（NPC本人在场，视线/听觉范围内）\n2. 直接告知（有明确的第三方NPC告诉了他，且第三方信息来源也合法）\n3. 物证推断（现场留下证据，且NPC有能力解读——但见下方\"痕迹≠指向\"规则）\n4. 公开信息（官方公告、张贴告示、公开宣布）\n5. 情报网络（NPC所属团体拥有情报网，且覆盖事件发生地，且需要传导时间）\n6. 世界观内的技术手段（监控、追踪术等，必须NPC有权使用）\n\n【禁止事项】\n- 禁止NPC\"就是知道了\"\n- 禁止将面板信息泄露给NPC（面板是玩家全知视角）\n- 禁止\"消息传得快\"作为万能解释——必须指明传播节点\n\n六、痕迹≠指向（两步跳跃禁止）\n物证/痕迹只能支撑\"发生了什么事\"，不能直接跳跃到\"是谁干的\"。\n- 第一步（合法）：火焰烧痕 → \"有人用火在这里战斗过\"\n- 第二步（需要独立证据）：\"用火的人是{{user}}\" → 必须有人同时满足：①认识{{user}}或{{user}}的独特特征 ②在场目睹或事后检验出独属于{{user}}的标记\n缺少第二步的独立证据时，NPC只能停留在第一步的模糊认知。\n\n七、匿名/化名身份保护\n{{user}}使用化名/匿名/伪装时，默认与本体无关联。关联条件（至少满足一项）：\n- 行动中暴露本体独特特征，且有认识本体的人在场\n- 使用了与本体相同的独特技能/物品，且有人同时见过两个身份\n- 主动透露\n- 被专业情报人员长期跟踪（至少3-5轮调查过程，需在事件链中推进）\n- 留下可追溯的硬证据（如注册信息直接关联真实身份）\n黑市/情报组织识破匿名身份同样需满足上述条件，不因\"是情报组织\"自动全知。\n</contact_and_info>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。",'{}','{}','{}','{}','ignore'],
    ['reputation','声誉','builtin','是','array','we_reputation','axis_key',70,"<reputation>\n\n一、四维声誉\n{{user}}的声誉拆为四个独立维度，每个维度5级，独立升降，互不冲销。\n- 朝堂之上：掌权建制力量对{{user}}的评价——朝廷/议会/公司董事会/教廷/联邦等。评价标准：守法/逆法、可用/危险、顺从/挑衅。\n- 市井之间：普通百姓/市民/街头舆论对{{user}}的口碑。评价标准：仁善/暴戾、慷慨/贪婪、保护者/威胁者。\n- 草莽之中：体制外力量对{{user}}的看法——绿林、走私者、佣兵、独立黑客、中间人、地下帮派等所有不在台面上吃饭的人。评价标准：不是你是否违法，而是你是否有种。敢以私力对抗体制不公的人受尊敬；只敢欺负弱者的人被鄙视。\n- 同道之间：{{user}}所在行当/职业圈内的同行评价。评价标准：技艺高低、是否守行规、是否对同行有贡献。\n\n五级层级（每个维度通用，从低到高）：天怒人怨 → 声名狼藉 → 默默无闻 → 受人尊敬 → 万众敬仰\n中点为\"默默无闻\"，向下两级为负评（声名狼藉、天怒人怨），向上两级为正评（受人尊敬、万众敬仰）。\n\n二、行为对维度的影响\n同一行为可同时影响多个维度：\n\n对【朝堂】的影响：\n- 协助朝堂、缉拿要犯、遵守法规 → 朝堂+\n- 违逆法律、私刑执法、公然抗命 → 朝堂-\n- 通敌叛国、勾结外敌 → 朝堂-（崩塌）\n\n对【市井】的影响：\n- 救济灾民、修桥铺路、保护百姓 → 市井+\n- 欺压良善、劫掠百姓、为害一方 → 市井-\n- 公然以私力惩罚公认的恶人 → 市井+（百姓觉得痛快，但朝堂会减分）\n\n对【草莽】的影响：\n- 以私力对抗体制不公、为被欺压者出头 → 草莽+（草莽崇拜有种的人）\n- 守诺重义、为友两肋插刀 → 草莽+\n- 反抗暴政、做了官面上不敢做的事 → 草莽+，朝堂-\n- 欺压平民、抢劫百姓 → 草莽-（草莽最恨骑在弱者头上的败类）\n- 出卖同道、背信弃义 → 草莽-（崩塌）\n- 恃强凌弱、敲诈勒索 → 草莽-（没种的懦夫行径）\n- 注意：草莽≠罪犯。烧杀抢掠不会自动获得草莽尊重——只有对抗不公体制或以过人身手行事才加分。\n\n对【同道】的影响：\n- 手艺出众、技艺精进 → 同道+\n- 行业贡献、提携后进 → 同道+\n- 背叛同行、出卖同道 → 同道-（崩塌）\n- 粗制滥造、砸行业招牌 → 同道-\n\n特殊机制：\n- 【风声前提】行为只有形成覆盖对应圈层的风声后，才能改变该圈层声誉。仅被单个人目击、尚未传播的行为不改变群体声誉。无人知晓的绝对隐秘行为（纳入信息黑盒）不影响四维声誉，仅在暗中影响受害者的个人恩怨。\n- 单一行为最多同时影响3个维度。\n- 【个人vs圈子区分】声誉变化以是否被该圈子普遍知晓为准；单一团体内部记仇仅算入该团体对{{user}}的关注度/核心人物对{{user}}的个人仇恨，不影响对应维度的整体评价。\n- 【草莽≠罪犯澄清】偷盗、抢劫、杀人等单纯的刑事犯罪不会提升草莽地位。草莽只尊敬那些\"有理由\"的反叛——对抗不义体制、替弱者出头、或以超凡身手行事。一个专抢平民的小偷在草莽眼中跟普通人一样被轻视，甚至更被鄙视。\n\n三、不同观察者看不同维度\n新生成NPC/团体的初始态度，按其所属圈子读取对应维度：\n- 朝堂/权贵/统治阶层 → 看【朝堂之上】\n- 平民/百姓/市民 → 看【市井之间】\n- 草莽/地下/体制外人士 → 看【草莽之中】\n- 同行/同职业/同道中人 → 看【同道之间】\n- 跨圈子人士（如朝堂卧底进草莽）→ 取两个维度的综合判断\n\n四、复合声誉效应\n- 朝堂+市井双高 → \"民心所向\"事件链（官方授勋/民意拥戴机会）\n- 市井+草莽双高 → \"替天行道\"事件链（百姓和草莽都认{{user}}是英雄，朝堂反而紧张）\n- 草莽+同道双高 → \"一方豪杰\"事件链（双线人脉，草莽和同行都敬你三分）\n- 朝堂高+草莽高 → \"双面身份\"事件链（暴露风险随时间累积）\n- 任一维度跌至天怒人怨 → 该圈子内\"通缉/追杀/驱逐/封杀\"事件链\n\n五、规则细节\n- 【反杀回升机制】通过反杀复仇团体获得的声誉提升，默认作用于同道之间（封顶\"受人尊敬\"）；若反杀对象为恶贯满盈的团体，则同时提升市井口碑与草莽地位。\n- 【声誉崩塌强制重估】\"背叛信任\"\"被揭穿谎言\"或恶劣罪行等事件，可使对应维度瞬间跨级跌落。此时强制要求AI重新评估所有已出场团体对{{user}}的关注度。\n- 【洗白难度】\"声名狼藉\"回升到\"默默无闻\"需多轮持续对应行为或一次重大正面事件。\n</reputation>\n\n声誉输出为 reputation 数组行：axis_key/axis_name/level/verdict/evidence/last_change。\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。","{\"moduleId\":\"reputation\",\"field\":\"reputation\",\"container\":\"array\",\"description\":\"声誉数组。当前数据库按维度行存储；只在 {{user}} 名声确有变化时返回相关维度。\",\"fields\":{\"axis_key\":{\"type\":\"enum|string\",\"description\":\"authority/common/shadow/circuit 或自定义维度键。\"},\"axis_name\":{\"type\":\"string\",\"description\":\"维度名称，如 朝堂之上/市井之间/草莽之中/同道之间。\"},\"level\":{\"type\":\"enum\",\"description\":\"声誉等级，使用当前预设词表。\"},\"verdict\":{\"type\":\"string\",\"description\":\"当前判词或圈层评价。\"},\"evidence\":{\"type\":\"string\",\"description\":\"声誉变化依据；必须有覆盖对应圈层的风声或公开事实。\"},\"last_change\":{\"type\":\"string\",\"description\":\"本轮变化简述，对应原 lastChange。\"}}}",'{}','{}','{}','upsert'],
    ['economy','经济','builtin','是','array','we_economy','economy_key',80,"<world_economy>\n\n经济脉搏是世界的血液循环，不是{{user}}的个人账本。它追踪的是整体经济气候和市场中值得注意的变化。\n\n一、经济气候\n\nclimate 表示当前区域的经济温度，用四词描述：\n- 繁荣：贸易旺盛、商路安全、物价稳定偏高\n- 平稳：日常运作、物价按季节自然波动\n- 衰退：需求萎缩、商号倒闭、少数刚需品反而暴涨\n- 动荡：战乱/灾荒/封锁导致经济秩序崩坏，以物易物回潮\n\nclimate 的 scope 是{{user}}当前所在区域及其直接关联的经济圈。远处的经济冷暖通过 economy.signal 行 补充。\n\n二、市场信号\n\neconomy 行的 signal 字段记录当前市场上值得注意的经济变化。跟踪标准：\n- 该变化足以影响势力行动、NPC决策或事件链走向\n- 不是日常波动——日常波动不配进 economy.signal 行\n- 一般不超过3条\n\n每项包含：\n- economy_key：稳定经济信号键\n- signal：一句话描述变化和影响\n- cause：可追溯原因\n- impact：影响\n- scope：影响的地理范围（具体区域名，不能写\"全境\"）\n\nAI 必须让每条 signal 有因果：变化的背后必须有可追溯的事件链或外部原因（天气、战事、贸易中断、新技术、囤积行为、投机）。不能凭空波动。\n\n三、风声与事件链联动\n\n- 物价暴涨、物资枯竭等重大变化 → 产生至少1条经济消息或舆情（见模块四）。\n- 人们获知经济风声并采取抢购、囤积、撤资等行动后，可反过来改变经济与事件链。\n- 禁止无视距离让经济信息瞬间全城皆知——economy.scope 和风声的 scope 必须一致。\n\n四、经济与事件链联动\n\n- 连续多轮出现同一方向的严重 signal → API 应创建一个推进型事件链，表示当地正在尝试解决（开辟新商路、寻找替代品等）。\n- 重大经济变化 → 影响势力间关系（受损方和受益方之间紧张度上升）。\n\n五、禁止事项\n\n- 禁止追踪{{user}}的个人钱包或背包。这是世界引擎，不是账房。\n- 禁止日常琐碎波动进入 economy.signal 行。\n- 禁止物资价格毫无原因地波动。\n- 禁止所有区域经济趋势完全一致。\n</world_economy>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。","{\"moduleId\":\"economy\",\"field\":\"economy\",\"container\":\"array\",\"description\":\"经济数组。当前数据库按 scope/signal 行存储；只在市场、道路、资源、价格、物流有实质变化时返回。\",\"fields\":{\"economy_key\":{\"type\":\"string\",\"description\":\"稳定经济信号键。\"},\"scope\":{\"type\":\"string\",\"description\":\"影响地理范围；必须具体。\"},\"climate\":{\"type\":\"enum\",\"description\":\"经济气候，使用当前预设词表；古风默认 繁荣/平稳/衰退/动荡。\"},\"signal\":{\"type\":\"string\",\"description\":\"市场信号摘要。\"},\"cause\":{\"type\":\"string\",\"description\":\"可追溯外部原因；不得凭空波动。\"},\"impact\":{\"type\":\"string\",\"description\":\"对势力、NPC、事件链、风声或行动条件的影响。\"},\"expires_round\":{\"type\":\"number\",\"description\":\"可选，过期轮次。\"}}}",'{}','{}',JSON.stringify({ maxRows: 30 }),'upsert'],
    ['enemies','仇敌录','builtin','是','array','we_enemies','enemy_key',90,"<enemies>\n\n仇敌是因{{user}}的具体伤害行为而产生的、不可逆的个人恩怨。仇敌的核心特征是永不淡化和跨区域追踪。它与势力层面的态度对立（factions.relation_to_user）是两套完全不同的东西——势力对立源于立场和利益，可以谈判；仇敌源于伤害，不可谈判。\n\n一、仇敌类型\n1. 血仇（enemy_type: \"blood\"）— 触发条件（满足任一）：{{user}}杀死某团体的核心人物（但失去权力的前核心人物除外，见势力模块的权力瓦解）；{{user}}导致某人至亲身亡或永久致残。\n   特性：永不淡化、不可谈判、复仇动机永不消失。即使复仇方资源耗尽，仇恨不会消退，只会因能力不足而暂时停滞。\n\n2. 非致死恩怨（enemy_type: \"grudge\"）— 触发条件（必须同时满足）：\n   - 不可逆伤害：{{user}}的行为造成了无法恢复的重大损失（废去武功、夺走毕生基业、设局导致破产/流放/被剥夺身份等）。\n   - 明确复仇意愿：受害者有强烈的、明确的复仇动机，不是泛泛的\"不喜欢\"或\"怀恨在心\"。\n   - 有追踪/报复能力：受害者有能力（资源、武艺、人脉、情报网）对{{user}}实施实际的追踪或报复。\n   不满足以上三项的不算grudge。被{{user}}辱骂、一次商业竞争失败、街头斗殴受伤——这些都不够资格进入仇敌录，应在叙事中由AI自然体现，不落盘。\n   特性：同样永不淡化，但恐怖程度通常低于血仇。\n\n二、仇敌行为与追踪\n- 血仇提供动机，不提供能力。追杀受势力等级约束：弱势力无法渗透强势力地盘。\n- 跨区域追踪需要时间。仇敌必须先通过合法手段定位{{user}}（情报网、线人、风声等），然后才能组织行动。\n- 仇敌stage = \"执行中\"时，每隔5-10轮才有几率真正发起一次追杀/报复行动。\n- 若仇敌势力 < {{user}}所在地保护势力，追杀强制停滞，转为\"追踪中\"并积蓄力量。\n\n三、仇敌触发（团体视角）\n当{{user}}的行为触发enemy_type=blood时，AI必须根据被杀者的身份判定团体走向：\n1. 被杀者为团体核心人物（失去权力的前核心人物除外）：\n   - 走向A（同仇敌忾）：若凝聚力较高且有明确继承人，继承人成为新核心，创建冲突型事件链。\n   - 走向B（内斗）：若派系林立，团体陷入争权夺利，复仇被搁置，原进度停滞。\n   - 走向C（解散）：若凝聚力低或资源枯竭，团体直接解散，从活跃面板移除。\n2. 被杀者为普通成员（或已失去权力的前核心人物）：创建临时复仇团体，名称格式：\"[被杀者姓名]的亲属复仇队\"。创建冲突型事件链。\n无论哪种路径，都必须在enemies中追加一条仇敌录条目，并在influence_chain中记录传导关系。\n\n四、仇敌终结\n只有当仇敌被{{user}}彻底消灭（杀死核心复仇者、摧毁复仇组织），才能标记stage=\"已终结\"。\n- 已终结的条目会保留20轮备忘后自动清除。\n- 反杀后{{user}}声誉可回升，但最高只能达到\"受人尊敬\"（若声誉模块启用）。\n- 对应的冲突型事件链同步标记为已终结。\n\n五、禁止事项\n- 禁止仅因\"被{{user}}辱骂\"\"商业竞争失败\"\"街头斗殴轻伤\"等可逆伤害创建仇敌条目。\n- 禁止将势力层面的态度对立（factions.relation_to_user = \"敌对\"）自动等同于仇敌。\n- 禁止为仇敌赋予超出其势力的能力。弱势力不能凭空召唤强援、渗透强领地或全知定位。\n</enemies>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。","{\"moduleId\":\"enemies\",\"field\":\"enemies\",\"container\":\"array\",\"description\":\"仇敌录数组。用于不可逆个人恩怨，不等同于势力关系敌对。输出字段直接对应 we_enemies。\",\"fields\":{\"enemy_key\":{\"type\":\"string\",\"description\":\"稳定仇敌键。\"},\"name\":{\"type\":\"string\",\"description\":\"仇敌名称。\"},\"enemy_type\":{\"type\":\"enum\",\"description\":\"blood/grudge。\"},\"grudge\":{\"type\":\"string\",\"description\":\"结仇原因。\"},\"severity\":{\"type\":\"number\",\"description\":\"1-10 严重度。\"},\"stage\":{\"type\":\"enum|string\",\"description\":\"追踪中/策划中/执行中/已终结 等。\"},\"resources\":{\"type\":\"array|string\",\"description\":\"可用资源。\"},\"knows_user_info\":{\"type\":\"string\",\"description\":\"掌握的 {{user}} 信息及合法来源。\"},\"current_plan\":{\"type\":\"string\",\"description\":\"当前计划。\"},\"terminal\":{\"type\":\"enum\",\"description\":\"是/否。\"}}}",'{}','{}',JSON.stringify({ maxRows: 30 }),'upsert'],
    ['regional_incident','区域突发事件','builtin','是','array','we_regional_incident','incident_key',100,"<regional_incident>\n\n一、系统定位\n本系统只负责生成区域级突发事件——足以影响一个地区、道路、城镇、关隘、码头、寺院、市场、村落、商路或水路的重大事件。\n不处理以下低价值事件（它们只适合作为正文里的环境描写）：马车受惊、偷情被抓、路人吵架、醉汉闹事、小偷行窃、普通邻里纠纷、远处有人打架、单人偶发事故。\n区域突发事件的例子：山贼劫道、水匪截船、商队被屠、连环杀人、城中大火、粮仓失火、洪涝、疫病、桥梁坍塌、官道断绝、饥荒粮荒、码头骚乱、地方民变、守军哗变、地震山崩、风暴雪灾。\n\n二、职责划分\n区域突发事件是否触发、以及触发哪种类型，完全由本地系统判定。本地不触发时，本规则不会要求你生成区域突发事件，你也不得自发生成。\n仅当本地判定触发并向你注入「区域突发强制指令」时，你才按指令指定的类型，生成具体事件标题、发生地点、影响范围、传播风声与外溢影响。\n\n三、事件类型\n- banditry 盗匪劫掠：山贼、水匪、流寇、贼伙、劫镖、截船、抢粮、抢盐、屠掠村寨或商队。\n- fire 大火：坊市、粮仓、码头、寺院、官署、工坊、船队、货栈发生区域性火灾。\n- massacre 恶性凶案：连环杀人、灭门案、客栈血案、商队被屠、码头尸案等足以引发恐慌的案件。\n- flood 洪涝：河水暴涨、堤坝决口、码头被淹、村田被毁、桥梁被冲毁。\n- infrastructure 道路水利崩坏：官道塌方、桥梁坍塌、渡口停摆、堤坝裂口、水闸损毁、驿路断绝。\n- plague 疫病：人疫、畜疫、水源染病、村落封闭、码头拒载、城中高热病人暴增。\n- famine 饥荒粮荒：粮仓见底、赈粮断供、粮价暴涨、灾民抢粮、大户闭仓、乡村断炊。\n- riot 骚乱暴动：码头械斗、饥民抢粮、香客踩踏、盐铺被砸、关卡冲突、市井冲突扩大。\n- rebellion 民变叛乱：流民立寨、乡兵反官、税役暴动、邪教聚众、地方叛乱。\n- military 军务突变：守军哗变、军粮被劫、边军溃逃、敌军越境、关隘戒严、军营夜惊。\n- earthquake 地震山崩：地震、山崩、矿山塌陷、地裂、山村被埋。\n- storm 风暴雪灾：台风、暴雪、沙暴、寒潮、海风毁船、大风摧毁棚屋。\n\n四、API生成要求\n当本地骰子触发并注入强制指令后，API必须：\n1. 根据指定类型生成区域级突发事件，事件影响一个明确的区域、道路、城镇、关隘、码头或其他地理范围。\n2. 事件必须产生可传播的风声。\n3. 事件必须造成至少一种外溢影响：经济变化、势力行动、治安变化、事件链变化、声誉变化、黑盒变化或新的影响链。\n4. 事件与{{user}}当前行为没有直接因果，不得写成已有仇敌、已有势力、已有事件链的阴谋结果。\n5. 不得凭空毁灭核心舞台，不得无故摧毁{{user}}核心资产。\n6. 如果事件未发生在{{user}}所在区域，不得强行打断{{user}}当前行动，只作为后台世界变化、远方消息或风声传播。\n7. 禁止将\"区域突发事件\"写成某个已有势力早已策划的阴谋。\n\n五、数据结构\n{\n  \"regional_incident\": [{ \"incident_key\": \"稳定事件键\", \"active\": \"是\", \"title\": \"事件标题\", \"incident_type\": \"事件类型\", \"scope\": \"影响范围\", \"impact\": \"一句话概括区域后果\" }]\ncooldown 由本地维护，API 不得输出或修改此字段。\n\n六、API返回最低要求\n触发后至少返回 regional_incident、winds、influence_chain。视情况可额外返回 events、economy、factions、reputation、blackbox。\n</regional_incident>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。","{\"moduleId\":\"regional_incident\",\"field\":\"regional_incident\",\"container\":\"array\",\"description\":\"区域突发事件数组。只在本地机制已有候选或持续事件时返回，不得自发凭空生成。输出字段直接对应 we_regional_incident。\",\"fields\":{\"incident_key\":{\"type\":\"string\",\"description\":\"稳定突发事件键。\"},\"active\":{\"type\":\"enum\",\"description\":\"是/否。\"},\"title\":{\"type\":\"string\",\"description\":\"事件标题。\"},\"incident_type\":{\"type\":\"string\",\"description\":\"事件类型。\"},\"scope\":{\"type\":\"string\",\"description\":\"影响范围。\"},\"impact\":{\"type\":\"string\",\"description\":\"当前区域后果。\"},\"remaining_rounds\":{\"type\":\"number\",\"description\":\"剩余轮次；通常由本地机制维护。\"},\"cooldown\":{\"type\":\"number\",\"description\":\"冷却轮次；通常由本地机制维护。\"}}}",JSON.stringify({ dice: { chance: 3, cooldown: 5, duration: 5 } }),'{}','{}','upsert'],
    ['blackbox','信息黑盒','builtin','是','array','we_blackbox','secret_key',110,"<secret_asset>\n\n一、信息黑盒定义（防上帝视角铁律）\n在剧情运行中，存在两类需要被放入【信息黑盒】严格隔离的内容：\n1. 隐秘行为（blackbox 中 category=action 的行）：{{user}}在无人目击、未留痕迹的情况下完成的行动（如深山杀牛、密室暗杀、无声潜入）。关键属性是痕迹——有没有目击者、有没有物证。\n2. 隐秘资产（blackbox 中 category=asset 的行）：{{user}}暗中持有、未公开展示的一切资源（如密信、毒药、把柄、藏匿的物资、暗桩线人、隐秘身份）。关键属性是暴露度和可用性。\n- blackbox 中 category=action 的行字段：每项 { secret_key, category, content, owner, witnesses, traces, exposure_risk, public_status }\n- blackbox 中 category=asset 的行字段：每项 { secret_key, category, content, owner, exposure_risk, public_status }\n\n二、知情权校验与物理隔离法则（最高优先级）\n1. 物理屏障原则：对于黑盒中的内容，所有未在案发现场、未直接参与的NPC，默认处于\"完全、彻底不知情\"的物理隔离状态。\n2. 禁绝上帝视角：AI绝对禁止将{{user}}的隐秘行为自动转化为全知事件。例如：{{user}}在深山里杀了一头牛，只要没有目击者，就算到了城里，也绝对没有任何人知道牛死了，更不可能知道是{{user}}杀的。\n3. 强制校验：AI在描写任何NPC（包括对话、动作、神态、心理活动）前，必须核对该NPC是否在黑盒的\"知情名单\"中。\n4. 绝对无知表现：若NPC不知情，AI绝对不可让其表现出任何暗示、怀疑、\"话里有话\"或\"第六感\"。不知情就是像白纸一样，NPC的反应必须彻底基于其当前的公开认知。\n5. 痕迹推理约束：若{{user}}留下明显物证，NPC必须通过符合其智力和身份的具体\"调查行动\"才能逐渐获取信息，绝不能直接\"顿悟\"或\"猜到\"。\n\n三、隐秘资产运作机制\n- exposure_risk：0-100，暴露风险。0=绝对隐秘，100=已完全公开。{{user}}频繁活动、当地警戒升级、向他人展示或暗示，均会导致暴露度上升。达到50有遭遇战/走漏风险，达到90可能被查抄/公开。\n- public_status：hidden/leaking/exposed；资产可用性写入 content 或 traces。有效=仍可调用；过期=情报过时；暴露=已被发现；失效=已不可用（如物资被查抄、线人断联、身份被识破）。\n- 资产演化：情报有时效性，相关事件发生后可能自动过期。物资藏匿点暴露度随时间自然上升，附近活动加速上升。线人/暗桩暴露后可被反向利用，身份暴露后失去行动灵活性。低暴露度+高有效性=安全资产；低暴露度+已过期=无人知道但已无用；高暴露度+已失效=已被发现且作废。\n</secret_asset>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。","{\"moduleId\":\"blackbox\",\"field\":\"blackbox\",\"container\":\"array\",\"description\":\"信息黑盒数组。当前数据库按秘密行存储；用于未公开、未传播、只有少数人知道的信息。\",\"fields\":{\"secret_key\":{\"type\":\"string\",\"description\":\"稳定秘密键。\"},\"category\":{\"type\":\"enum\",\"description\":\"action/asset/knowledge/relationship/other。\"},\"content\":{\"type\":\"string\",\"description\":\"秘密内容；秘密行为或资产内容。\"},\"owner\":{\"type\":\"string\",\"description\":\"归属者。\"},\"witnesses\":{\"type\":\"array|string\",\"description\":\"目击者；无目击写 无。\"},\"traces\":{\"type\":\"array|string\",\"description\":\"可追溯痕迹；无痕迹写 无或留空。\"},\"exposure_risk\":{\"type\":\"number\",\"description\":\"0-100 暴露风险，对应原 exposure。\"},\"public_status\":{\"type\":\"enum\",\"description\":\"hidden/leaking/exposed；对应原 有效/过期/暴露/失效 时需合理映射。\"}}}",JSON.stringify({ exposureStep: 5 }),'{}',JSON.stringify({ maxRows: 80 }),'upsert'],
    ['trends','天下大势','builtin','是','array','we_custom_state','item_key',120,"<world_trends>\n\n天下大势是已经改变国家、国际或整个世界运行方式的长期局势。它不是普通风声，也不是等待推进的事件链，而是其他系统行动时必须考虑的世界级约束。\n\n一、数据结构\n每条包含：\n- name：稳定的大势名称，同名覆盖更新。\n- scope：实际影响范围。\n- status：\"持续中\"/\"已结束\"。\n- description：当前局势及其正在如何约束世界行动。\n- source：形成该大势的明确来源。\n\n二、形成条件\n每轮检查以下候选来源：\n- Lv4 冲突型事件进入\"已爆发\"。\n- Lv4 推进型事件进入\"已完成\"，且成果改变国家或国际格局。\n- Lv4 风声背后的事实被广泛确认，并持续影响多个势力。\n- 战争、夺嫡、全国大案、政权更替、全球灾害等长期局势已经形成。\n\n候选来源不等于自动创建。只有同时满足\"长期持续、广域影响、跨系统作用、迫使多个势力持续调整行动\"时，才创建天下大势。全国节庆、单次公告、短期轰动、普通重大新闻不算天下大势。\n\n三、持续与结束\n- 天下大势不参与骰子，不自动消散，也不因某轮未返回而删除。\n- 所有 status=\"持续中\" 的天下大势，每轮都必须作为事件链、势力、经济、风声与NPC行动的背景约束。\n- 大势本身没有 effects 字段。具体影响应落实到对应系统，并在产生跨系统变化时写入 influence_chain。\n- 只有出现明确改变局势的事实时才更新 description；只有局势确定结束时才标记为\"已结束\"。\n- 已结束的大势是历史结果，不得重新变为持续中；若类似局势再次发生，应创建新名称的大势。\n</world_trends>\n\n【数据库字段适配】本模块规则只用于因果推演；输出 JSON 必须使用当前输出契约中的数据库字段名，不得输出原程序 camelCase 字段或原对象结构。","{\"moduleId\":\"trends\",\"field\":\"custom\",\"container\":\"object\",\"description\":\"天下大势通过 custom.trends 数组输出并写入 we_custom_state。\",\"fields\":{\"item_key\":{\"type\":\"string\",\"description\":\"稳定大势键。\"},\"name\":{\"type\":\"string\",\"description\":\"大势名称。\"},\"scope\":{\"type\":\"string\",\"description\":\"实际影响范围。\"},\"status\":{\"type\":\"enum\",\"description\":\"持续中/已结束。\"},\"description\":{\"type\":\"string\",\"description\":\"当前局势及其约束。\"},\"source\":{\"type\":\"string\",\"description\":\"形成来源。\"}}}",'{}','{}',JSON.stringify({ maxRows: 30 }),'upsert'],
  ];
  const initStatements = [];
  for (const item of modules) {
    initStatements.push(insertIfMissingSql('we_modules', 'module_id', item[0],
      ['module_id','module_name','kind','enabled','container','state_table','item_key','order_no','rules','output_contract','mechanics_json','display_json','lifecycle_json','merge_strategy','updated_at'],
      [...item, nowText()]
    ));
  }
  const outputContract = "{\"schemas\":{\"events\":{\"moduleId\":\"events\",\"field\":\"events\",\"container\":\"array\",\"description\":\"事件链数组。只返回本轮有推进、停滞、转向、结束或新建的事件。输出字段直接对应 we_events。\",\"fields\":{\"event_key\":{\"type\":\"string\",\"description\":\"稳定事件键；同一事件必须沿用，用于更新既有记录。\"},\"title\":{\"type\":\"string\",\"description\":\"事件标题，对应原 name。\"},\"event_type\":{\"type\":\"enum\",\"description\":\"conflict/progress/custom。conflict=冲突型，progress=推进型；新事件必须明确。\"},\"stage\":{\"type\":\"string\",\"description\":\"当前阶段。conflict 使用 萌芽/发酵/逼近/已爆发/已消散；progress 使用 筹备/执行/关键/已完成/已失败。\"},\"progress\":{\"type\":\"number\",\"description\":\"0-100 的阶段进度。\"},\"scope\":{\"type\":\"string\",\"description\":\"事件影响范围。\"},\"actors\":{\"type\":\"array|string\",\"description\":\"参与方或行动者 JSON/短文本。\"},\"cause\":{\"type\":\"string\",\"description\":\"起因。\"},\"current_state\":{\"type\":\"string\",\"description\":\"本轮事件变化说明。\"},\"next_pressure\":{\"type\":\"string\",\"description\":\"后续压力、恢复条件或下一步风险。\"},\"visibility\":{\"type\":\"enum\",\"description\":\"public/rumor/private/unknown。\"},\"terminal\":{\"type\":\"enum\",\"description\":\"是/否；已爆发、已消散、已完成、已失败通常为 是。\"},\"expires_round\":{\"type\":\"number\",\"description\":\"可选，过期轮次。\"}}},\"factions\":{\"moduleId\":\"factions\",\"field\":\"factions\",\"container\":\"array\",\"description\":\"势力数组。记录组织、团体、家族、门派、公司或其他可持续行动的集体。输出字段直接对应 we_factions。\",\"fields\":{\"faction_key\":{\"type\":\"string\",\"description\":\"稳定势力键；同一势力必须沿用。\"},\"name\":{\"type\":\"string\",\"description\":\"势力名称。\"},\"type\":{\"type\":\"string\",\"description\":\"势力类型。\"},\"scope\":{\"type\":\"string\",\"description\":\"势力直接控制或重大影响范围。\"},\"status\":{\"type\":\"enum\",\"description\":\"整体状态，使用当前预设词表；古风默认 鼎盛/稳固/倾轧/困顿/衰落/瓦解。\"},\"relation_to_user\":{\"type\":\"enum\",\"description\":\"对 {{user}} 态度；古风默认 血盟/盟友/友好/中立/冷淡/敌对/世仇。\"},\"goal\":{\"type\":\"string\",\"description\":\"当前目标。\"},\"resources\":{\"type\":\"array|string\",\"description\":\"资源或权力支柱。\"},\"core_people\":{\"type\":\"array|string\",\"description\":\"核心人物 JSON/短文本，对应原 core_person。\"},\"internal_conflict\":{\"type\":\"string\",\"description\":\"内部矛盾。\"},\"known_info\":{\"type\":\"string\",\"description\":\"该势力合法获知的信息，必须符合传播规则。\"},\"last_action\":{\"type\":\"string\",\"description\":\"本轮最近行动。\"}}},\"winds\":{\"moduleId\":\"winds\",\"field\":\"winds\",\"container\":\"array\",\"description\":\"风声数组。记录正在传播的信息、谣言、公告、舆情。输出字段直接对应 we_winds。\",\"fields\":{\"wind_key\":{\"type\":\"string\",\"description\":\"稳定风声键；同一 topic 更新时沿用。\"},\"topic\":{\"type\":\"string\",\"description\":\"稳定主题名。\"},\"content\":{\"type\":\"string\",\"description\":\"当前正在传播的具体说法。\"},\"source\":{\"type\":\"string\",\"description\":\"来源与传播链；与 {{user}} 相关时必须写完整信息链。\"},\"channel\":{\"type\":\"enum|string\",\"description\":\"announcement/report/rumor/sentiment 或传播渠道。\"},\"scope\":{\"type\":\"string\",\"description\":\"实际传播到的地区或圈层。\"},\"credibility\":{\"type\":\"enum\",\"description\":\"真实/半真半假/谣言/未证实；若原规则不要求可信度，可按传播性质谨慎填写。\"},\"intensity\":{\"type\":\"number\",\"description\":\"0-10 强度；由原 level 1-4 映射，传播规模越大越高。\"},\"decay_rounds\":{\"type\":\"number\",\"description\":\"可选，剩余衰减轮次；通常省略由本地机制维护。\"},\"visible_to_user\":{\"type\":\"enum\",\"description\":\"是/否；{{user}} 所在范围可感知时为 是。\"}}},\"reputation\":{\"moduleId\":\"reputation\",\"field\":\"reputation\",\"container\":\"array\",\"description\":\"声誉数组。当前数据库按维度行存储；只在 {{user}} 名声确有变化时返回相关维度。\",\"fields\":{\"axis_key\":{\"type\":\"enum|string\",\"description\":\"authority/common/shadow/circuit 或自定义维度键。\"},\"axis_name\":{\"type\":\"string\",\"description\":\"维度名称，如 朝堂之上/市井之间/草莽之中/同道之间。\"},\"level\":{\"type\":\"enum\",\"description\":\"声誉等级，使用当前预设词表。\"},\"verdict\":{\"type\":\"string\",\"description\":\"当前判词或圈层评价。\"},\"evidence\":{\"type\":\"string\",\"description\":\"声誉变化依据；必须有覆盖对应圈层的风声或公开事实。\"},\"last_change\":{\"type\":\"string\",\"description\":\"本轮变化简述，对应原 lastChange。\"}}},\"economy\":{\"moduleId\":\"economy\",\"field\":\"economy\",\"container\":\"array\",\"description\":\"经济数组。当前数据库按 scope/signal 行存储；只在市场、道路、资源、价格、物流有实质变化时返回。\",\"fields\":{\"economy_key\":{\"type\":\"string\",\"description\":\"稳定经济信号键。\"},\"scope\":{\"type\":\"string\",\"description\":\"影响地理范围；必须具体。\"},\"climate\":{\"type\":\"enum\",\"description\":\"经济气候，使用当前预设词表；古风默认 繁荣/平稳/衰退/动荡。\"},\"signal\":{\"type\":\"string\",\"description\":\"市场信号摘要。\"},\"cause\":{\"type\":\"string\",\"description\":\"可追溯外部原因；不得凭空波动。\"},\"impact\":{\"type\":\"string\",\"description\":\"对势力、NPC、事件链、风声或行动条件的影响。\"},\"expires_round\":{\"type\":\"number\",\"description\":\"可选，过期轮次。\"}}},\"enemies\":{\"moduleId\":\"enemies\",\"field\":\"enemies\",\"container\":\"array\",\"description\":\"仇敌录数组。用于不可逆个人恩怨，不等同于势力关系敌对。输出字段直接对应 we_enemies。\",\"fields\":{\"enemy_key\":{\"type\":\"string\",\"description\":\"稳定仇敌键。\"},\"name\":{\"type\":\"string\",\"description\":\"仇敌名称。\"},\"enemy_type\":{\"type\":\"enum\",\"description\":\"blood/grudge。\"},\"grudge\":{\"type\":\"string\",\"description\":\"结仇原因。\"},\"severity\":{\"type\":\"number\",\"description\":\"1-10 严重度。\"},\"stage\":{\"type\":\"enum|string\",\"description\":\"追踪中/策划中/执行中/已终结 等。\"},\"resources\":{\"type\":\"array|string\",\"description\":\"可用资源。\"},\"knows_user_info\":{\"type\":\"string\",\"description\":\"掌握的 {{user}} 信息及合法来源。\"},\"current_plan\":{\"type\":\"string\",\"description\":\"当前计划。\"},\"terminal\":{\"type\":\"enum\",\"description\":\"是/否。\"}}},\"influence_chain\":{\"moduleId\":\"influence_chain\",\"field\":\"influence_chain\",\"container\":\"array\",\"description\":\"影响链数组。只记录真实产生外溢影响的跨系统传导。输出字段直接对应 we_influence_chain。\",\"fields\":{\"chain_key\":{\"type\":\"string\",\"description\":\"稳定影响链键；同一影响链更新时沿用。\"},\"source_module\":{\"type\":\"string\",\"description\":\"触发源模块，如 winds/events/economy。\"},\"source_key\":{\"type\":\"string\",\"description\":\"触发源记录键。\"},\"direct_effect\":{\"type\":\"string\",\"description\":\"已经发生的直接影响，对应原 impact。\"},\"propagated_to\":{\"type\":\"array|string\",\"description\":\"传导目标。\"},\"evidence\":{\"type\":\"string\",\"description\":\"因果证据。\"},\"status\":{\"type\":\"enum\",\"description\":\"active/settled/expired。\"},\"expires_round\":{\"type\":\"number\",\"description\":\"可选，过期轮次。\"}}},\"blackbox\":{\"moduleId\":\"blackbox\",\"field\":\"blackbox\",\"container\":\"array\",\"description\":\"信息黑盒数组。当前数据库按秘密行存储；用于未公开、未传播、只有少数人知道的信息。\",\"fields\":{\"secret_key\":{\"type\":\"string\",\"description\":\"稳定秘密键。\"},\"category\":{\"type\":\"enum\",\"description\":\"action/asset/knowledge/relationship/other。\"},\"content\":{\"type\":\"string\",\"description\":\"秘密内容；秘密行为或资产内容。\"},\"owner\":{\"type\":\"string\",\"description\":\"归属者。\"},\"witnesses\":{\"type\":\"array|string\",\"description\":\"目击者；无目击写 无。\"},\"traces\":{\"type\":\"array|string\",\"description\":\"可追溯痕迹；无痕迹写 无或留空。\"},\"exposure_risk\":{\"type\":\"number\",\"description\":\"0-100 暴露风险，对应原 exposure。\"},\"public_status\":{\"type\":\"enum\",\"description\":\"hidden/leaking/exposed；对应原 有效/过期/暴露/失效 时需合理映射。\"}}},\"regional_incident\":{\"moduleId\":\"regional_incident\",\"field\":\"regional_incident\",\"container\":\"array\",\"description\":\"区域突发事件数组。只在本地机制已有候选或持续事件时返回，不得自发凭空生成。输出字段直接对应 we_regional_incident。\",\"fields\":{\"incident_key\":{\"type\":\"string\",\"description\":\"稳定突发事件键。\"},\"active\":{\"type\":\"enum\",\"description\":\"是/否。\"},\"title\":{\"type\":\"string\",\"description\":\"事件标题。\"},\"incident_type\":{\"type\":\"string\",\"description\":\"事件类型。\"},\"scope\":{\"type\":\"string\",\"description\":\"影响范围。\"},\"impact\":{\"type\":\"string\",\"description\":\"当前区域后果。\"},\"remaining_rounds\":{\"type\":\"number\",\"description\":\"剩余轮次；通常由本地机制维护。\"},\"cooldown\":{\"type\":\"number\",\"description\":\"冷却轮次；通常由本地机制维护。\"}}},\"trends\":{\"moduleId\":\"trends\",\"field\":\"custom\",\"container\":\"object\",\"description\":\"天下大势通过 custom.trends 数组输出并写入 we_custom_state。\",\"fields\":{\"item_key\":{\"type\":\"string\",\"description\":\"稳定大势键。\"},\"name\":{\"type\":\"string\",\"description\":\"大势名称。\"},\"scope\":{\"type\":\"string\",\"description\":\"实际影响范围。\"},\"status\":{\"type\":\"enum\",\"description\":\"持续中/已结束。\"},\"description\":{\"type\":\"string\",\"description\":\"当前局势及其约束。\"},\"source\":{\"type\":\"string\",\"description\":\"形成来源。\"}}}},\"allowed_top_fields\":[\"world_digest\",\"events\",\"factions\",\"winds\",\"reputation\",\"economy\",\"enemies\",\"influence_chain\",\"blackbox\",\"regional_incident\",\"custom\"],\"example\":{\"events\":[{\"event_key\":\"blood_blade_revenge\",\"title\":\"血刀门复仇\",\"event_type\":\"conflict\",\"stage\":\"发酵\",\"progress\":55,\"scope\":\"青石关及周边三镇\",\"actors\":[\"血刀门追踪者\"],\"cause\":\"少主被杀后的血仇\",\"current_state\":\"血刀门派出追踪者，在青石关外三里亭设了暗哨\",\"next_pressure\":\"若风声传到渡口，追踪者会盘查往来船客\",\"visibility\":\"private\",\"terminal\":\"否\"}],\"factions\":[{\"faction_key\":\"blood_blade_sect\",\"name\":\"血刀门\",\"type\":\"门派\",\"scope\":\"血刀岭及周边三镇\",\"status\":\"稳固\",\"relation_to_user\":\"敌对\",\"goal\":\"复仇\",\"resources\":[\"武力威慑\",\"情报网\"],\"core_people\":[\"血刀老祖\"],\"known_info\":\"只知道凶手可能经青石关南下\",\"last_action\":\"派出两队追踪者\"}],\"winds\":[{\"wind_key\":\"qingshiguan_checkpoint\",\"topic\":\"青石关设卡\",\"content\":\"青石关北门已有官兵设卡盘查\",\"source\":\"目击商贩->往来商队\",\"channel\":\"report\",\"scope\":\"青石关及周边村镇\",\"credibility\":\"真实\",\"intensity\":5,\"visible_to_user\":\"是\"}],\"reputation\":[{\"axis_key\":\"common\",\"axis_name\":\"市井之间\",\"level\":\"默默无闻\",\"verdict\":\"街面上没什么人听过他\",\"evidence\":\"无覆盖市井圈层的相关风声\",\"last_change\":\"无变化\"}],\"economy\":[{\"economy_key\":\"qingshiguan_freight_delay\",\"scope\":\"青石关北门\",\"climate\":\"平稳\",\"signal\":\"设卡导致北门货车排队，脚夫加价\",\"cause\":\"官兵设卡盘查\",\"impact\":\"商队改走东门，消息向周边村镇扩散\"}],\"enemies\":[{\"enemy_key\":\"blood_blade_sect\",\"name\":\"血刀门\",\"enemy_type\":\"blood\",\"grudge\":\"{{user}}杀了血刀门少主\",\"severity\":7,\"stage\":\"执行中\",\"resources\":[\"追踪者\",\"悬赏\"],\"knows_user_info\":\"经幸存门人描述掌握体貌，但无当前位置\",\"current_plan\":\"沿青石关商路布眼线\",\"terminal\":\"否\"}],\"influence_chain\":[{\"chain_key\":\"blood_blade_reward_to_checkpoint\",\"source_module\":\"enemies\",\"source_key\":\"blood_blade_sect\",\"direct_effect\":\"血刀门悬赏令让草莽中人开始留意 {{user}} 行踪\",\"propagated_to\":[\"winds\",\"events\"],\"evidence\":\"悬赏令先传到青石关脚夫圈，再形成设卡传闻\",\"status\":\"active\"}],\"blackbox\":[{\"secret_key\":\"secret_midnight_meeting\",\"category\":\"action\",\"content\":\"密室会谈\",\"owner\":\"{{user}}\",\"witnesses\":\"无\",\"traces\":\"无\",\"exposure_risk\":0,\"public_status\":\"hidden\"}],\"regional_incident\":[],\"custom\":{\"trends\":[{\"item_key\":\"northern_war\",\"name\":\"北境战争\",\"scope\":\"北境三州及周边诸国\",\"status\":\"持续中\",\"description\":\"边军与北境诸部进入长期战争，征粮、征兵与商路封锁持续改变各方行动\",\"source\":\"Lv4冲突型事件「北境战争」进入已爆发\"}]},\"world_digest\":\"血刀门追踪者在青石关外三里亭设了暗哨；青石关北门开始设卡盘查，脚夫和商队正在把消息带向周边村镇；北境战事继续压着粮道与商路。\"},\"instructions\":\"## JSON 输出字段说明\\n\\n你必须输出一个 JSON 对象。只输出本轮有实质变化的字段；禁止为了凑数制造无意义内容。\\n本制品采用数据库字段名输出：不要输出原程序 camelCase 顶层字段；如你内部按原规则推演，必须映射为下列字段。\\n允许的顶层字段：world_digest, events, factions, winds, reputation, economy, enemies, influence_chain, blackbox, regional_incident, custom。\\n\\n### events（数组）\\n事件链数组。只返回本轮有推进、停滞、转向、结束或新建的事件。输出字段直接对应 we_events。\\n- event_key [string]: 稳定事件键；同一事件必须沿用，用于更新既有记录。\\n- title [string]: 事件标题，对应原 name。\\n- event_type [enum]: conflict/progress/custom。conflict=冲突型，progress=推进型；新事件必须明确。\\n- stage [string]: 当前阶段。conflict 使用 萌芽/发酵/逼近/已爆发/已消散；progress 使用 筹备/执行/关键/已完成/已失败。\\n- progress [number]: 0-100 的阶段进度。\\n- scope [string]: 事件影响范围。\\n- actors [array|string]: 参与方或行动者 JSON/短文本。\\n- cause [string]: 起因。\\n- current_state [string]: 本轮事件变化说明。\\n- next_pressure [string]: 后续压力、恢复条件或下一步风险。\\n- visibility [enum]: public/rumor/private/unknown。\\n- terminal [enum]: 是/否；已爆发、已消散、已完成、已失败通常为 是。\\n- expires_round [number]: 可选，过期轮次。\\n\\n### factions（数组）\\n势力数组。记录组织、团体、家族、门派、公司或其他可持续行动的集体。输出字段直接对应 we_factions。\\n- faction_key [string]: 稳定势力键；同一势力必须沿用。\\n- name [string]: 势力名称。\\n- type [string]: 势力类型。\\n- scope [string]: 势力直接控制或重大影响范围。\\n- status [enum]: 整体状态，使用当前预设词表；古风默认 鼎盛/稳固/倾轧/困顿/衰落/瓦解。\\n- relation_to_user [enum]: 对 {{user}} 态度；古风默认 血盟/盟友/友好/中立/冷淡/敌对/世仇。\\n- goal [string]: 当前目标。\\n- resources [array|string]: 资源或权力支柱。\\n- core_people [array|string]: 核心人物 JSON/短文本，对应原 core_person。\\n- internal_conflict [string]: 内部矛盾。\\n- known_info [string]: 该势力合法获知的信息，必须符合传播规则。\\n- last_action [string]: 本轮最近行动。\\n\\n### winds（数组）\\n风声数组。记录正在传播的信息、谣言、公告、舆情。输出字段直接对应 we_winds。\\n- wind_key [string]: 稳定风声键；同一 topic 更新时沿用。\\n- topic [string]: 稳定主题名。\\n- content [string]: 当前正在传播的具体说法。\\n- source [string]: 来源与传播链；与 {{user}} 相关时必须写完整信息链。\\n- channel [enum|string]: announcement/report/rumor/sentiment 或传播渠道。\\n- scope [string]: 实际传播到的地区或圈层。\\n- credibility [enum]: 真实/半真半假/谣言/未证实；若原规则不要求可信度，可按传播性质谨慎填写。\\n- intensity [number]: 0-10 强度；由原 level 1-4 映射，传播规模越大越高。\\n- decay_rounds [number]: 可选，剩余衰减轮次；通常省略由本地机制维护。\\n- visible_to_user [enum]: 是/否；{{user}} 所在范围可感知时为 是。\\n\\n### reputation（数组）\\n声誉数组。当前数据库按维度行存储；只在 {{user}} 名声确有变化时返回相关维度。\\n- axis_key [enum|string]: authority/common/shadow/circuit 或自定义维度键。\\n- axis_name [string]: 维度名称，如 朝堂之上/市井之间/草莽之中/同道之间。\\n- level [enum]: 声誉等级，使用当前预设词表。\\n- verdict [string]: 当前判词或圈层评价。\\n- evidence [string]: 声誉变化依据；必须有覆盖对应圈层的风声或公开事实。\\n- last_change [string]: 本轮变化简述，对应原 lastChange。\\n\\n### economy（数组）\\n经济数组。当前数据库按 scope/signal 行存储；只在市场、道路、资源、价格、物流有实质变化时返回。\\n- economy_key [string]: 稳定经济信号键。\\n- scope [string]: 影响地理范围；必须具体。\\n- climate [enum]: 经济气候，使用当前预设词表；古风默认 繁荣/平稳/衰退/动荡。\\n- signal [string]: 市场信号摘要。\\n- cause [string]: 可追溯外部原因；不得凭空波动。\\n- impact [string]: 对势力、NPC、事件链、风声或行动条件的影响。\\n- expires_round [number]: 可选，过期轮次。\\n\\n### enemies（数组）\\n仇敌录数组。用于不可逆个人恩怨，不等同于势力关系敌对。输出字段直接对应 we_enemies。\\n- enemy_key [string]: 稳定仇敌键。\\n- name [string]: 仇敌名称。\\n- enemy_type [enum]: blood/grudge。\\n- grudge [string]: 结仇原因。\\n- severity [number]: 1-10 严重度。\\n- stage [enum|string]: 追踪中/策划中/执行中/已终结 等。\\n- resources [array|string]: 可用资源。\\n- knows_user_info [string]: 掌握的 {{user}} 信息及合法来源。\\n- current_plan [string]: 当前计划。\\n- terminal [enum]: 是/否。\\n\\n### influence_chain（数组）\\n影响链数组。只记录真实产生外溢影响的跨系统传导。输出字段直接对应 we_influence_chain。\\n- chain_key [string]: 稳定影响链键；同一影响链更新时沿用。\\n- source_module [string]: 触发源模块，如 winds/events/economy。\\n- source_key [string]: 触发源记录键。\\n- direct_effect [string]: 已经发生的直接影响，对应原 impact。\\n- propagated_to [array|string]: 传导目标。\\n- evidence [string]: 因果证据。\\n- status [enum]: active/settled/expired。\\n- expires_round [number]: 可选，过期轮次。\\n\\n### blackbox（数组）\\n信息黑盒数组。当前数据库按秘密行存储；用于未公开、未传播、只有少数人知道的信息。\\n- secret_key [string]: 稳定秘密键。\\n- category [enum]: action/asset/knowledge/relationship/other。\\n- content [string]: 秘密内容；秘密行为或资产内容。\\n- owner [string]: 归属者。\\n- witnesses [array|string]: 目击者；无目击写 无。\\n- traces [array|string]: 可追溯痕迹；无痕迹写 无或留空。\\n- exposure_risk [number]: 0-100 暴露风险，对应原 exposure。\\n- public_status [enum]: hidden/leaking/exposed；对应原 有效/过期/暴露/失效 时需合理映射。\\n\\n### regional_incident（数组）\\n区域突发事件数组。只在本地机制已有候选或持续事件时返回，不得自发凭空生成。输出字段直接对应 we_regional_incident。\\n- incident_key [string]: 稳定突发事件键。\\n- active [enum]: 是/否。\\n- title [string]: 事件标题。\\n- incident_type [string]: 事件类型。\\n- scope [string]: 影响范围。\\n- impact [string]: 当前区域后果。\\n- remaining_rounds [number]: 剩余轮次；通常由本地机制维护。\\n- cooldown [number]: 冷却轮次；通常由本地机制维护。\\n\\n### custom.trends（数组）\\n天下大势输出到 custom.trends，每项字段：item_key/name/scope/status/description/source。\\n\\n### world_digest（字符串）\\n本轮后台世界推演叙事，50-200字。描述后台发生的世界变化，不要泄露给 NPC。\\n\\n## JSON 输出示例\\n{\\n  \\\"events\\\": [\\n    {\\n      \\\"event_key\\\": \\\"blood_blade_revenge\\\",\\n      \\\"title\\\": \\\"血刀门复仇\\\",\\n      \\\"event_type\\\": \\\"conflict\\\",\\n      \\\"stage\\\": \\\"发酵\\\",\\n      \\\"progress\\\": 55,\\n      \\\"scope\\\": \\\"青石关及周边三镇\\\",\\n      \\\"actors\\\": [\\n        \\\"血刀门追踪者\\\"\\n      ],\\n      \\\"cause\\\": \\\"少主被杀后的血仇\\\",\\n      \\\"current_state\\\": \\\"血刀门派出追踪者，在青石关外三里亭设了暗哨\\\",\\n      \\\"next_pressure\\\": \\\"若风声传到渡口，追踪者会盘查往来船客\\\",\\n      \\\"visibility\\\": \\\"private\\\",\\n      \\\"terminal\\\": \\\"否\\\"\\n    }\\n  ],\\n  \\\"factions\\\": [\\n    {\\n      \\\"faction_key\\\": \\\"blood_blade_sect\\\",\\n      \\\"name\\\": \\\"血刀门\\\",\\n      \\\"type\\\": \\\"门派\\\",\\n      \\\"scope\\\": \\\"血刀岭及周边三镇\\\",\\n      \\\"status\\\": \\\"稳固\\\",\\n      \\\"relation_to_user\\\": \\\"敌对\\\",\\n      \\\"goal\\\": \\\"复仇\\\",\\n      \\\"resources\\\": [\\n        \\\"武力威慑\\\",\\n        \\\"情报网\\\"\\n      ],\\n      \\\"core_people\\\": [\\n        \\\"血刀老祖\\\"\\n      ],\\n      \\\"known_info\\\": \\\"只知道凶手可能经青石关南下\\\",\\n      \\\"last_action\\\": \\\"派出两队追踪者\\\"\\n    }\\n  ],\\n  \\\"winds\\\": [\\n    {\\n      \\\"wind_key\\\": \\\"qingshiguan_checkpoint\\\",\\n      \\\"topic\\\": \\\"青石关设卡\\\",\\n      \\\"content\\\": \\\"青石关北门已有官兵设卡盘查\\\",\\n      \\\"source\\\": \\\"目击商贩->往来商队\\\",\\n      \\\"channel\\\": \\\"report\\\",\\n      \\\"scope\\\": \\\"青石关及周边村镇\\\",\\n      \\\"credibility\\\": \\\"真实\\\",\\n      \\\"intensity\\\": 5,\\n      \\\"visible_to_user\\\": \\\"是\\\"\\n    }\\n  ],\\n  \\\"reputation\\\": [\\n    {\\n      \\\"axis_key\\\": \\\"common\\\",\\n      \\\"axis_name\\\": \\\"市井之间\\\",\\n      \\\"level\\\": \\\"默默无闻\\\",\\n      \\\"verdict\\\": \\\"街面上没什么人听过他\\\",\\n      \\\"evidence\\\": \\\"无覆盖市井圈层的相关风声\\\",\\n      \\\"last_change\\\": \\\"无变化\\\"\\n    }\\n  ],\\n  \\\"economy\\\": [\\n    {\\n      \\\"economy_key\\\": \\\"qingshiguan_freight_delay\\\",\\n      \\\"scope\\\": \\\"青石关北门\\\",\\n      \\\"climate\\\": \\\"平稳\\\",\\n      \\\"signal\\\": \\\"设卡导致北门货车排队，脚夫加价\\\",\\n      \\\"cause\\\": \\\"官兵设卡盘查\\\",\\n      \\\"impact\\\": \\\"商队改走东门，消息向周边村镇扩散\\\"\\n    }\\n  ],\\n  \\\"enemies\\\": [\\n    {\\n      \\\"enemy_key\\\": \\\"blood_blade_sect\\\",\\n      \\\"name\\\": \\\"血刀门\\\",\\n      \\\"enemy_type\\\": \\\"blood\\\",\\n      \\\"grudge\\\": \\\"{{user}}杀了血刀门少主\\\",\\n      \\\"severity\\\": 7,\\n      \\\"stage\\\": \\\"执行中\\\",\\n      \\\"resources\\\": [\\n        \\\"追踪者\\\",\\n        \\\"悬赏\\\"\\n      ],\\n      \\\"knows_user_info\\\": \\\"经幸存门人描述掌握体貌，但无当前位置\\\",\\n      \\\"current_plan\\\": \\\"沿青石关商路布眼线\\\",\\n      \\\"terminal\\\": \\\"否\\\"\\n    }\\n  ],\\n  \\\"influence_chain\\\": [\\n    {\\n      \\\"chain_key\\\": \\\"blood_blade_reward_to_checkpoint\\\",\\n      \\\"source_module\\\": \\\"enemies\\\",\\n      \\\"source_key\\\": \\\"blood_blade_sect\\\",\\n      \\\"direct_effect\\\": \\\"血刀门悬赏令让草莽中人开始留意 {{user}} 行踪\\\",\\n      \\\"propagated_to\\\": [\\n        \\\"winds\\\",\\n        \\\"events\\\"\\n      ],\\n      \\\"evidence\\\": \\\"悬赏令先传到青石关脚夫圈，再形成设卡传闻\\\",\\n      \\\"status\\\": \\\"active\\\"\\n    }\\n  ],\\n  \\\"blackbox\\\": [\\n    {\\n      \\\"secret_key\\\": \\\"secret_midnight_meeting\\\",\\n      \\\"category\\\": \\\"action\\\",\\n      \\\"content\\\": \\\"密室会谈\\\",\\n      \\\"owner\\\": \\\"{{user}}\\\",\\n      \\\"witnesses\\\": \\\"无\\\",\\n      \\\"traces\\\": \\\"无\\\",\\n      \\\"exposure_risk\\\": 0,\\n      \\\"public_status\\\": \\\"hidden\\\"\\n    }\\n  ],\\n  \\\"regional_incident\\\": [],\\n  \\\"custom\\\": {\\n    \\\"trends\\\": [\\n      {\\n        \\\"item_key\\\": \\\"northern_war\\\",\\n        \\\"name\\\": \\\"北境战争\\\",\\n        \\\"scope\\\": \\\"北境三州及周边诸国\\\",\\n        \\\"status\\\": \\\"持续中\\\",\\n        \\\"description\\\": \\\"边军与北境诸部进入长期战争，征粮、征兵与商路封锁持续改变各方行动\\\",\\n        \\\"source\\\": \\\"Lv4冲突型事件「北境战争」进入已爆发\\\"\\n      }\\n    ]\\n  },\\n  \\\"world_digest\\\": \\\"血刀门追踪者在青石关外三里亭设了暗哨；青石关北门开始设卡盘查，脚夫和商队正在把消息带向周边村镇；北境战事继续压着粮道与商路。\\\"\\n}\"}";
  initStatements.push(insertIfMissingSql('we_prompt_templates', 'template_name', 'default',
    ['template_name','enabled','system_prompt','user_prompt_template','output_contract_json','final_directive','worldbook_strategy','context_turns','updated_at'],
    ['default','是',"你是一个世界推演引擎。每轮对话后，后台世界必须自动向前推进一步。请根据世界规则和本轮对话，更新世界状态。只输出严格 JSON，不要有其他文字。","你是一个世界推演引擎。每轮对话后，后台世界必须自动向前推进一步。\n请根据世界规则和本轮对话，更新世界状态。只输出 JSON，不要有其他文字。\n\n推演时按以下因果顺序检查：\n1. 【私密判定·最先执行】先判定本轮 {{user}} 及相关人物的行为有无目击者、是否留下可追溯痕迹。凡在无目击、未留痕迹的情况下发生的私密行为，一律计入 blackbox，并且不得据此生成风声、声誉、事件链或 NPC 行动。\n2. 将所有持续中的天下大势作为本轮世界级约束，并检查是否形成新大势或已有大势明确结束。\n3. 判断本轮事实、行动与公开信息是否形成新风声。\n4. 检查已有风声是否获得新的合法传播节点，并据此更新传播范围、内容和来源。\n5. 判断风声实际覆盖了哪些势力、圈层或行动者；只有被覆盖者才能据此改变判断与行动。\n6. 天下大势或风声造成跨系统变化时，在对应状态字段中落实结果，并用 influence_chain 记录传导过程。\n7. 声誉判定：只有 {{user}} 的行为已形成覆盖对应圈层的风声后，才改动对应维度声誉。\n8. 仇敌判定：已有仇敌只有通过覆盖其情报来源的风声或其他合法渠道获知线索后，才能推进追踪，且受势力等级约束。\n9. 经济判定：只有事件链或可追溯外部原因驱动时才更新；重大经济变化须生成对应风声。\n10. 不得从面板全知信息直接跳到 NPC 行动，不得为了产生联动而虚构传播节点。\n\n========== 世界推演规则 ==========\n{{module_rules}}\n\n## 默认前台事实\n{{default_tables}}\n\n## 当前世界状态\n{{world_state}}\n\n## 近期对话\n{{recent_story}}\n\n## 世界书\n{{worldbook}}\n\n## 已启用模块输出契约\n{{output_contract}}",outputContract,'只输出 JSON 对象，不要输出解释、Markdown 或自由文本；只输出启用模块；只输出本轮发生变化的记录。','current',3,nowText()]
  ));
  initStatements.push(insertIfMissingSql('we_reputation', 'axis_key', 'public', ['axis_key','axis_name','level','verdict','evidence','last_change','updated_round'], ['public','市井声誉','普通','尚无明确公开评价。','','初始化',0]));
  initStatements.push(insertIfMissingSql('we_reputation', 'axis_key', 'faction', ['axis_key','axis_name','level','verdict','evidence','last_change','updated_round'], ['faction','势力声誉','中立','各势力尚无明确共同评价。','','初始化',0]));
  initStatements.push(insertIfMissingSql('we_reputation', 'axis_key', 'law', ['axis_key','axis_name','level','verdict','evidence','last_change','updated_round'], ['law','秩序声誉','普通','秩序与法律层面尚无明确评价。','','初始化',0]));
  initStatements.push(insertIfMissingSql('we_world_digest', 'round', 0, ['round','digest','visible_digest','hidden_digest','created_at'], [0,'World 后台已启用，暂无公开后台事件。','<world_state>\nWorld 后台已启用，暂无公开后台事件。\n</world_state>','',nowText()]));
  initStatements.push("DELETE FROM we_custom_state WHERE module_id NOT IN (SELECT module_id FROM we_modules WHERE enabled='是')");
    await b(initStatements);
    const runtimeConfig = rows(q("SELECT module_id, module_name, state_table, merge_strategy FROM we_modules WHERE enabled='是' ORDER BY order_no ASC"));
    return { ok: true, world_id: first('SELECT world_id FROM we_meta LIMIT 1')?.world_id || worldId, modules: runtimeConfig.length };
  } catch (error) {
    const message = String(error?.message || error);
    ctx.log.error('[World 初始化器] 初始化失败: ' + message);
    if (tableExists('we_meta')) {
      const meta = first('SELECT * FROM we_meta LIMIT 1');
      if (meta) await m('UPDATE we_meta SET last_error=?, updated_at=? WHERE row_id=?', [message, nowText(), meta.row_id]);
    }
    return { ok: false, error: message };
  }
}
try { return await main(); } catch (error) { ctx.log.error('[World 世界书读取器] 顶层异常: ' + String(error?.message || error)); throw error; }`;

const worldbookReaderSource = importWorldHelpers(['first','tableExists','rows','q','compact','writeDiagnostic']) + String.raw`
async function main() {
  const strategy = String(ctx.input?.worldbook_strategy || ctx.config?.worldbook_strategy || ctx.input?.worldbookStrategy || ctx.config?.worldbookStrategy || 'current');
  if (strategy === 'none') return { scanText: '', worldbook: '' };
  const aiResponse = String(ctx.input?.aiResponse || ctx.input?.response || ctx.event?.aiResponse || ctx.event?.response || '');
  const global = first('SELECT * FROM global_state WHERE row_id=1') || {};
  const protagonist = tableExists('protagonist_info') ? first('SELECT * FROM protagonist_info LIMIT 1') : null;
  const importantTable = tableExists('important_non_romance') ? 'important_non_romance' : (tableExists('important_characters') ? 'important_characters' : '');
  const importantCharacters = importantTable ? rows(q('SELECT * FROM ' + importantTable + ' LIMIT 8')) : [];
  const chronicle = rows(q('SELECT code_index, summary FROM chronicle ORDER BY row_id DESC LIMIT 5'));
  const quests = rows(q('SELECT * FROM quests_events ORDER BY row_id DESC LIMIT 5'));
  const events = tableExists('we_events') ? rows(q("SELECT title, stage, scope, current_state FROM we_events WHERE terminal='否' ORDER BY updated_round DESC LIMIT 10")) : [];
  const factions = tableExists('we_factions') ? rows(q('SELECT name, status, scope, goal FROM we_factions ORDER BY updated_round DESC LIMIT 10')) : [];
  const winds = tableExists('we_winds') ? rows(q('SELECT topic, scope, credibility, intensity FROM we_winds WHERE intensity >= 3 ORDER BY intensity DESC, updated_round DESC LIMIT 10')) : [];
  const regional = tableExists('we_regional_incident') ? rows(q("SELECT title, incident_type, scope, impact FROM we_regional_incident WHERE active='是' ORDER BY updated_round DESC LIMIT 5")) : [];
  const leakingSecrets = tableExists('we_blackbox') ? rows(q("SELECT category, owner, exposure_risk FROM we_blackbox WHERE public_status='leaking' AND exposure_risk >= 80 ORDER BY exposure_risk DESC LIMIT 5")) : [];
  const keywordSet = new Set();
  for (const r of rows(q("SELECT module_name, rules FROM we_modules WHERE enabled='是' ORDER BY order_no ASC LIMIT 20"))) {
    if (r.module_name) keywordSet.add(String(r.module_name).slice(0, 20));
    for (const token of String(r.rules || '').match(/[\u4e00-\u9fa5A-Za-z0-9_]{2,12}/g) || []) if (keywordSet.size < 40) keywordSet.add(token);
  }
  const templateKeywordSource = [
    first("SELECT system_prompt,user_prompt_template,final_directive FROM we_prompt_templates WHERE enabled='是' ORDER BY row_id ASC LIMIT 1")?.system_prompt || '',
    first("SELECT user_prompt_template FROM we_prompt_templates WHERE enabled='是' ORDER BY row_id ASC LIMIT 1")?.user_prompt_template || '',
    first("SELECT final_directive FROM we_prompt_templates WHERE enabled='是' ORDER BY row_id ASC LIMIT 1")?.final_directive || '',
  ].join('\n');
  for (const token of String(templateKeywordSource || '').match(/[\u4e00-\u9fa5A-Za-z0-9_]{2,12}/g) || []) if (keywordSet.size < 60) keywordSet.add(token);
  const keywords = [...keywordSet].slice(0, 60).join('、');
  const scanText = [
    '<worldbook_scan_for_world_evolution>',
    '当前时间：' + (global.cur_time || ''),
    '当前地点：' + [global.current_major_region, global.current_minor_region, global.current_location].filter(Boolean).join(' / '),
    '主角状态：\n' + (protagonist ? Object.values(protagonist).filter(Boolean).slice(1, 8).join('；') : ''),
    '已登场重要角色：\n' + importantCharacters.map(r => '- ' + Object.values(r).filter(Boolean).slice(1, 6).join('；')).join('\n'),
    '本轮剧情：\n' + compact(aiResponse, 2000),
    '最近纪要：\n' + chronicle.map(r => '- ' + (r.code_index || '') + '：' + (r.summary || '')).join('\n'),
    '当前任务：\n' + quests.map(r => '- ' + Object.values(r).filter(Boolean).slice(1, 4).join('；')).join('\n'),
    '活跃后台事件：\n' + events.map(r => '- ' + [r.title, r.stage, r.scope, r.current_state].filter(Boolean).join('；')).join('\n'),
    '相关势力：\n' + factions.map(r => '- ' + [r.name, r.status, r.scope, r.goal].filter(Boolean).join('；')).join('\n'),
    '公开风声：\n' + winds.map(r => '- ' + [r.topic, r.scope, r.credibility].filter(Boolean).join('；')).join('\n'),
    '激活区域事件：\n' + regional.map(r => '- ' + [r.title, r.incident_type, r.scope, r.impact].filter(Boolean).join('；')).join('\n'),
    '接近暴露的非敏感黑盒关键词：\n' + leakingSecrets.map(r => '- ' + [r.category, r.owner, '风险' + r.exposure_risk].filter(Boolean).join('；')).join('\n'),
    '额外关键词：\n' + keywords,
    '</worldbook_scan_for_world_evolution>',
  ].join('\n');
  const worldbookOptions = ctx.input?.worldbookOptions || ctx.config?.worldbookOptions || {};
  const selected = ctx.input?.selectedWorldbookEntries || ctx.config?.selectedWorldbookEntries || ctx.input?.worldbookSelection || ctx.config?.worldbookSelection;
  const options = strategy === 'selected'
    ? (selected ? { ...worldbookOptions, selected } : { ...worldbookOptions, strategyFallback: 'current', reason: 'selected_worldbook_unavailable' })
    : worldbookOptions;
  let worldbook = '';
  try {
    worldbook = await ctx.api.renderWorldbookForPrompt(scanText, options);
    if (strategy === 'selected' && !selected) ctx.log.warn('[World 世界书读取器] selected 策略缺少公开选择参数，已降级为 current。');
  } catch (error) {
    ctx.log.warn('[World 世界书读取器] 世界书读取失败，降级为空文本: ' + String(error?.message || error));
    if (tableExists('we_ledger')) await writeDiagnostic('worldbook_reader_warning', { strategy, error: String(error?.message || error) }, first('SELECT round FROM we_meta LIMIT 1')?.round || 0);
  }
  return { scanText, worldbook };
}
try { return await main(); } catch (error) { ctx.log.error('[World 摘要器] 顶层异常: ' + String(error?.message || error)); throw error; }`;

const summarizerSource = importWorldHelpers(['first','rows','q','compact','previewWorldMechanics','m','nowText']) + String.raw`
async function main() {
  const meta = first('SELECT * FROM we_meta LIMIT 1') || { round: 0 };
  const round = Number(meta.round || 0);
  const limits = { events: 6, winds: 6, factions: 6, reputation: 5, economy: 4, enemies: 4, regional: 4, maxChars: 2400 };
  const events = rows(q("SELECT title, stage, scope, visibility, current_state FROM we_events WHERE terminal='否' AND visibility IN ('public','rumor') ORDER BY updated_round DESC LIMIT ?", [limits.events]));
  const winds = rows(q("SELECT topic, scope, credibility, intensity FROM we_winds WHERE visible_to_user='是' OR intensity >= 3 ORDER BY intensity DESC, updated_round DESC LIMIT ?", [limits.winds]));
  const factions = rows(q('SELECT name, status, relation_to_user, last_action FROM we_factions ORDER BY updated_round DESC LIMIT ?', [limits.factions]));
  const reputation = rows(q('SELECT axis_name, level, verdict FROM we_reputation ORDER BY updated_round DESC LIMIT ?', [limits.reputation]));
  const economy = rows(q('SELECT scope, climate, signal, impact FROM we_economy ORDER BY updated_round DESC LIMIT ?', [limits.economy]));
  const enemies = rows(q("SELECT name, enemy_type, severity, stage FROM we_enemies WHERE terminal='否' ORDER BY severity DESC, updated_round DESC LIMIT ?", [limits.enemies]));
  const regional = rows(q("SELECT title, incident_type, scope, impact FROM we_regional_incident WHERE active='是' ORDER BY updated_round DESC LIMIT ?", [limits.regional]));
  const blackboxStats = first("SELECT COUNT(*) AS total, SUM(CASE WHEN public_status='leaking' THEN 1 ELSE 0 END) AS leaking, SUM(CASE WHEN public_status='exposed' THEN 1 ELSE 0 END) AS exposed FROM we_blackbox") || {};
  const tableSizes = {};
  for (const table of ['we_events','we_factions','we_winds','we_reputation','we_economy','we_enemies','we_influence_chain','we_blackbox','we_regional_incident','we_custom_state']) tableSizes[table] = Number(first('SELECT COUNT(*) AS count FROM ' + table)?.count || 0);
  const visible = [
    '<world_state>',
    '轮次：' + round,
    '叙事约束：不要让角色知道黑盒秘密；未传播的信息不能直接改变公众态度；不在场 NPC 可以行动，但正文只呈现角色能合理接触到的结果。',
    '当前可感知事件：',
    ...events.map(r => '- ' + [r.title, r.stage, r.scope, r.current_state].filter(Boolean).join('；')),
    '公开风声：',
    ...winds.map(r => '- ' + [r.topic, r.scope, r.credibility].filter(Boolean).join('；')),
    '势力态势：',
    ...factions.map(r => '- ' + [r.name, r.status, r.relation_to_user, r.last_action].filter(Boolean).join('；')),
    '声誉：',
    ...reputation.map(r => '- ' + [r.axis_name, r.level, r.verdict].filter(Boolean).join('；')),
    '经济信号：',
    ...economy.map(r => '- ' + [r.scope, r.climate, r.signal, r.impact].filter(Boolean).join('；')),
    '仇敌动向：',
    ...enemies.map(r => '- ' + [r.name, r.enemy_type, r.severity, r.stage].filter(Boolean).join('；')),
    '区域事件：',
    ...regional.map(r => '- ' + [r.title, r.incident_type, r.scope, r.impact].filter(Boolean).join('；')),
    '</world_state>',
  ].join('\n');
  const visibleDigest = compact(visible, limits.maxChars);
  const mechanicsPreview = previewWorldMechanics(round, 'summarizer');
  const hidden = JSON.stringify({ blackbox: blackboxStats, tableSizes, limits, mechanicsPreview }, null, 2);
  await m('INSERT INTO we_world_digest (round,digest,visible_digest,hidden_digest,created_at) VALUES (?,?,?,?,?) ON CONFLICT(round) DO UPDATE SET digest=excluded.digest, visible_digest=excluded.visible_digest, hidden_digest=excluded.hidden_digest, created_at=excluded.created_at', [round, visibleDigest, visibleDigest, hidden, nowText()]);
  if (ctx.api.refreshDataAndWorldbook) await ctx.api.refreshDataAndWorldbook();
  return { ok: true, round };
}
try { return await main(); } catch (error) { ctx.log.error('[World 机制执行器] 顶层异常: ' + String(error?.message || error)); throw error; }`;

const mechanicsSource = importWorldHelpers(['first','runWorldMechanics']) + String.raw`
function applyMergeStrategy(currentValue, nextValue, strategy) {
  if (strategy === 'ignore') return currentValue;
  if (strategy === 'replace') return nextValue;
  if (strategy === 'append') {
    const current = Array.isArray(currentValue) ? currentValue : (currentValue == null ? [] : [currentValue]);
    const next = Array.isArray(nextValue) ? nextValue : (nextValue == null ? [] : [nextValue]);
    return [...current, ...next].filter((item, index, arr) => arr.findIndex(other => JSON.stringify(other) === JSON.stringify(item)) === index);
  }
  if (strategy === 'patch') {
    if (currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue) && nextValue && typeof nextValue === 'object' && !Array.isArray(nextValue)) return { ...currentValue, ...nextValue };
    return nextValue ?? currentValue;
  }
  return nextValue ?? currentValue;
}
function verdictFor(value, config) {
  const map = config?.map && typeof config.map === 'object' ? config.map : {};
  if (Object.prototype.hasOwnProperty.call(map, value)) return map[value];
  const levels = Array.isArray(config?.levels) ? config.levels : [];
  if (!levels.length) return String(value ?? '');
  const index = Math.max(0, Math.min(levels.length - 1, Number(value || 0)));
  return String(levels[index]);
}
async function main() {
  const meta = first('SELECT * FROM we_meta LIMIT 1') || { round: 0 };
  const round = Number(meta.round || 0);
  return await runWorldMechanics(round, 'mechanics_script');
}
return await main();`;

const evolverSource = importWorldHelpers(['WE_TABLES','tableExists','first','rows','q','m','nowText','safeJson','stableMessageId','writeDiagnostic','buildWorldSnapshot','runWorldScriptByName','hashText','parseStrictJsonObject','restoreWorldSnapshotFromCheckpoint','runWorldMechanics']) + String.raw`
async function main() {
  const missing = WE_TABLES.filter(name => !tableExists(name));
  if (missing.length) return { ok: false, skipped: true, reason: 'missing_tables', missing };
  const meta = first('SELECT * FROM we_meta LIMIT 1');
  const messageIdentity = stableMessageId();
  const messageId = messageIdentity.messageId;
  async function skipped(reason) {
    await m("INSERT INTO we_ledger (request_id,round,message_id,status,prompt_digest,started_at,finished_at,error) VALUES (?,?,?,?,?,?,?,?)", ['skip_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), Number(meta?.round || 0), messageId, 'skipped', reason, nowText(), nowText(), reason]);
    return { ok: true, skipped: true, reason };
  }
  if (!meta || meta.enabled !== '是') return await skipped('disabled');
  if (messageId && meta.last_message_id === messageId) return await skipped('duplicate_message');
  if (messageIdentity.degraded) await writeDiagnostic('message_id_degraded', { strategy: messageIdentity.reason, floor: messageIdentity.floor, responseHash: messageIdentity.responseHash, timeBucket: messageIdentity.timeBucket, messageId }, Number(meta.round || 0));
  const round = Number(meta.round || 0) + 1;
  if (Number(meta.evolve_every || 1) > 1 && round % Number(meta.evolve_every) !== 0) return await skipped('evolve_every');
  const requestId = 'we_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const startedAt = nowText();
  const snapshot = buildWorldSnapshot();
  const checkpointId = 'checkpoint_' + round + '_' + Date.now();
  await b([
    ['INSERT INTO we_checkpoints (checkpoint_id,round,message_id,snapshot_json,reason,created_at) VALUES (?,?,?,?,?,?)', [checkpointId, round - 1, messageId, safeJson(snapshot, {}), 'before_evolution', startedAt]],
    ["INSERT INTO we_ledger (request_id,round,message_id,status,prompt_digest,started_at) VALUES (?,?,?,?,?,?)", [requestId, round, messageId, 'running', '', startedAt]],
  ]);
  try {
    await runLocalMechanics(round);
    let promptTemplate = first("SELECT * FROM we_prompt_templates WHERE template_name=? AND enabled='是'", [meta.active_preset || 'default']);
    if (!promptTemplate) {
      promptTemplate = first("SELECT * FROM we_prompt_templates WHERE template_name='default'");
      await writeDiagnostic('prompt_template_fallback', { activePreset: meta.active_preset || '', fallback: 'default' }, round);
      ctx.log.warn('[World 推演器] active_preset 不可用，已回退 default: ' + String(meta.active_preset || ''));
    }
    const modules = rows(q("SELECT * FROM we_modules WHERE enabled='是' ORDER BY order_no ASC"));
    const importantTable = tableExists('important_non_romance') ? 'important_non_romance' : (tableExists('important_characters') ? 'important_characters' : '');
    const defaultFacts = safeJson({
      global: first('SELECT * FROM global_state WHERE row_id=1'),
      protagonist: tableExists('protagonist_info') ? first('SELECT * FROM protagonist_info LIMIT 1') : null,
      importantCharacters: importantTable ? rows(q('SELECT * FROM ' + importantTable + ' LIMIT 20')) : [],
      skills: tableExists('protagonist_skills') ? rows(q('SELECT * FROM protagonist_skills LIMIT 20')) : [],
      inventory: tableExists('inventory') ? rows(q('SELECT * FROM inventory LIMIT 20')) : [],
      quests: tableExists('quests_events') ? rows(q('SELECT * FROM quests_events LIMIT 20')) : [],
      chronicle: rows(q('SELECT code_index, summary FROM chronicle ORDER BY row_id DESC LIMIT 5')),
    }, {});
    const worldState = safeJson({
      meta,
      modules,
      events: rows(q('SELECT * FROM we_events LIMIT 20')),
      factions: rows(q('SELECT * FROM we_factions LIMIT 20')),
      winds: rows(q('SELECT * FROM we_winds LIMIT 20')),
      reputation: rows(q('SELECT * FROM we_reputation LIMIT 20')),
      economy: rows(q('SELECT * FROM we_economy LIMIT 20')),
      enemies: rows(q('SELECT * FROM we_enemies LIMIT 20')),
      influence_chain: rows(q('SELECT * FROM we_influence_chain LIMIT 20')),
      blackbox: rows(q('SELECT secret_key, category, owner, exposure_risk, public_status FROM we_blackbox LIMIT 20')),
      regional_incident: rows(q('SELECT * FROM we_regional_incident LIMIT 20')),
      custom: rows(q('SELECT * FROM we_custom_state LIMIT 50')),
    }, {});
    const contextTurns = Number(promptTemplate?.context_turns || 3);
    const recentStory = ctx.api.getStoryContext ? String(await ctx.api.getStoryContext(contextTurns) || '') : String(ctx.event?.aiResponse || '');
    let worldbook = '';
    const worldbookStrategy = promptTemplate?.worldbook_strategy || 'current';
    if (worldbookStrategy !== 'none') {
      const readerInput = {
        ...((ctx.input && typeof ctx.input === 'object') ? ctx.input : {}),
        worldbook_strategy: worldbookStrategy,
        aiResponse: String(ctx.event?.aiResponse || ctx.event?.response || ''),
      };
      const scan = await runWorldScriptByName('World 世界书读取器', readerInput);
      worldbook = scan?.worldbook || '';
    }
    const outputContract = promptTemplate?.output_contract_json || '{}';
    const userPrompt = String(promptTemplate?.user_prompt_template || '')
      .replace('{{default_tables}}', defaultFacts)
      .replace('{{world_state}}', worldState)
      .replace('{{recent_story}}', recentStory)
      .replace('{{worldbook}}', String(worldbook || ''))
      .replace('{{module_rules}}', modules.map(m => m.module_name + ': ' + m.rules).join('\n'))
      .replace('{{output_contract}}', outputContract);
    const messages = [{ role: 'system', content: String(promptTemplate?.system_prompt || '只输出严格 JSON。') }, { role: 'user', content: userPrompt + '\n' + String(promptTemplate?.final_directive || '') }];
    const promptDigest = ctx.config?.debugMode === true ? safeJson({ systemHash: hashText(messages[0].content), userHash: hashText(messages[1].content), userLength: messages[1].content.length, worldbookLength: String(worldbook || '').length }, {}) : '';
    if (promptDigest) await m("UPDATE we_ledger SET prompt_digest=? WHERE request_id=?", [promptDigest, requestId]);
    const options = meta.api_preset_override ? { presetName: meta.api_preset_override } : {};
    let raw = '';
    let parsed = null;
    try {
      raw = await ctx.api.callAI(messages, options);
      parsed = parseStrictJsonObject(raw);
    } catch (error) {
      const message = String(error?.message || error);
      await b([
        ["UPDATE we_ledger SET status='failed', raw_response=?, error=?, finished_at=? WHERE request_id=?", [String(raw || ''), message, nowText(), requestId]],
        ['UPDATE we_meta SET last_error=?, updated_at=? WHERE row_id=?', [message, nowText(), meta.row_id]],
      ]);
      return { ok: false, error: message };
    }
    const strictMode = ctx.config?.strictMode === true;
    await validateWorldResult(parsed, modules, round);
    if (!hasEffectiveWorldChanges(parsed)) throw new Error('World 推演输出没有任何有效字段');
    await mergeWorldResult(parsed, round, strictMode, modules, checkpointId);
    await b([
      ['UPDATE we_meta SET round=?, last_message_id=?, last_checkpoint_id=?, last_error=NULL, updated_at=? WHERE row_id=?', [round, messageId, checkpointId, nowText(), meta.row_id]],
      ["UPDATE we_ledger SET status='success', raw_response=?, parsed_json=?, finished_at=? WHERE request_id=?", [String(raw || ''), safeJson(parsed, {}), nowText(), requestId]],
    ]);
    try {
      await runWorldScriptByName('World 摘要器', { round, source: 'evolver' });
    } catch (summaryError) {
      const summaryMessage = String(summaryError?.message || summaryError);
      if (strictMode) {
        await restoreWorldSnapshotFromCheckpoint(checkpointId, 'summary_failed');
        throw new Error('World 摘要器失败并已回滚: ' + summaryMessage);
      }
      await writeDiagnostic('summary_warning', { error: summaryMessage }, round);
      ctx.log.warn('[World 推演器] 摘要器失败，已按宽松模式保留后台状态: ' + summaryMessage);
    }
    return { ok: true, round };
  } catch (error) {
    const message = String(error?.message || error);
    ctx.log.error('[World 推演器] 推演失败: ' + message);
    await b([
      ["UPDATE we_ledger SET status='failed', error=?, finished_at=? WHERE request_id=?", [message, nowText(), requestId]],
      ['UPDATE we_meta SET last_error=?, updated_at=? WHERE row_id=?', [message, nowText(), meta.row_id]],
    ]);
    return { ok: false, error: message };
  }
}
function upsertStatement(table, key, record, round, columns) {
  if (!record || typeof record !== 'object' || !record[key]) return null;
  const row = { ...record, updated_round: round };
  const writeColumns = columns.filter(c => c in row);
  const assignments = writeColumns.filter(c => c !== key).map(c => c + '=excluded.' + c).join(',');
  const sql = 'INSERT INTO ' + table + ' (' + writeColumns.join(',') + ') VALUES (' + writeColumns.map(() => '?').join(',') + ') ON CONFLICT(' + key + ') DO UPDATE SET ' + assignments;
  return [sql, writeColumns.map(c => typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c])];
}
function normalizeRecord(record, round, columns, defaults) {
  const source = record && typeof record === 'object' ? record : {};
  const row = { ...(defaults || {}) };
  for (const c of columns) if (source[c] !== undefined) row[c] = source[c];
  if (columns.includes('updated_round')) row.updated_round = round;
  if (columns.includes('created_round') && row.created_round == null) row.created_round = round;
  return row;
}
function deleteThenInsertStatements(table, key, record, round, columns, defaults) {
  const row = normalizeRecord(record, round, columns, defaults);
  if (!row[key]) return [];
  return [['DELETE FROM ' + table + ' WHERE ' + key + '=?', [row[key]]], insertPlainStatement(table, row, columns)].filter(Boolean);
}
function insertPlainStatement(table, row, columns) {
  const writeColumns = columns.filter(c => row[c] !== undefined);
  if (!writeColumns.length) return null;
  return ['INSERT INTO ' + table + ' (' + writeColumns.join(',') + ') VALUES (' + writeColumns.map(() => '?').join(',') + ')', writeColumns.map(c => typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c])];
}
function patchExistingStatement(table, key, record, round, columns, defaults) {
  const row = normalizeRecord(record, round, columns, defaults);
  if (!row[key]) return null;
  const existed = first('SELECT * FROM ' + table + ' WHERE ' + key + '=? LIMIT 1', [row[key]]) || {};
  const patched = { ...existed, ...row };
  return upsertStatement(table, key, patched, round, columns);
}
function appendRecordStatement(table, key, record, round, columns, defaults) {
  const row = normalizeRecord(record, round, columns, defaults);
  if (!row[key]) return null;
  const existed = first('SELECT row_id FROM ' + table + ' WHERE ' + key + '=? LIMIT 1', [row[key]]);
  if (existed) row[key] = String(row[key]) + '_' + round + '_' + Date.now();
  return insertPlainStatement(table, row, columns);
}
function mergeRecordStatementsByStrategy(moduleId, table, key, record, round, columns, defaults, strategyMap) {
  const strategy = strategyMap[moduleId] || 'upsert';
  if (strategy === 'ignore') return [];
  if (strategy === 'replace') return deleteThenInsertStatements(table, key, record, round, columns, defaults);
  if (strategy === 'append') return [appendRecordStatement(table, key, record, round, columns, defaults)].filter(Boolean);
  if (strategy === 'patch') return [patchExistingStatement(table, key, record, round, columns, defaults)].filter(Boolean);
  return [upsertStatement(table, key, normalizeRecord(record, round, columns, defaults), round, columns)].filter(Boolean);
}
function detectFullSnapshot(result) {
  const reasons = [];
  if (Array.isArray(result.events) && result.events.length >= 15) reasons.push('events_many_rows');
  if (Array.isArray(result.factions) && result.factions.length >= 15) reasons.push('factions_many_rows');
  if (Array.isArray(result.winds) && result.winds.length >= 15) reasons.push('winds_many_rows');
  if (result.world_digest && (Array.isArray(result.events) || Array.isArray(result.factions)) && !Object.keys(result).some(k => k === 'influence_chain')) reasons.push('digest_with_large_state_without_chain');
  return reasons;
}
async function runLocalMechanics(round) {
  return await runWorldMechanics(round, 'evolver');
}
async function mergeWorldResult(result, round, strictMode, modules, checkpointId) {
  const strategyMap = Object.fromEntries((modules || []).map(m => [String(m.module_id || ''), String(m.merge_strategy || 'upsert')]));
  const snapshotReasons = detectFullSnapshot(result);
  if (snapshotReasons.length) {
    await writeDiagnostic('full_snapshot_suspected', { reasons: snapshotReasons }, round);
    if (strictMode) throw new Error('模型疑似输出完整状态快照: ' + snapshotReasons.join(','));
  }
  const steps = [
    ['world_digest', () => result.world_digest ? [['INSERT INTO we_world_digest (round,digest,visible_digest,hidden_digest,created_at) VALUES (?,?,?,?,?) ON CONFLICT(round) DO UPDATE SET digest=excluded.digest, visible_digest=excluded.visible_digest, hidden_digest=excluded.hidden_digest, created_at=excluded.created_at', [round, result.world_digest.digest || '', result.world_digest.visible_digest || '', result.world_digest.hidden_digest || '', nowText()]]] : []],
    ['events', () => (result.events || []).flatMap(r => mergeRecordStatementsByStrategy('events','we_events','event_key',r,round,['event_key','title','event_type','stage','progress','scope','actors','cause','current_state','next_pressure','visibility','terminal','expires_round','updated_round'], { event_type: 'custom', progress: 0, visibility: 'hidden', terminal: '否' }, strategyMap))],
    ['factions', () => (result.factions || []).flatMap(r => mergeRecordStatementsByStrategy('factions','we_factions','faction_key',r,round,['faction_key','name','type','scope','status','relation_to_user','goal','resources','core_people','internal_conflict','known_info','last_action','updated_round'], { status: 'unknown', relation_to_user: '中立' }, strategyMap))],
    ['winds', () => (result.winds || []).flatMap(r => mergeRecordStatementsByStrategy('winds','we_winds','wind_key',r,round,['wind_key','topic','content','source','channel','scope','credibility','intensity','decay_rounds','visible_to_user','updated_round'], { credibility: '未证实', intensity: 1, decay_rounds: 3, visible_to_user: '否' }, strategyMap))],
    ['reputation', () => (result.reputation || []).flatMap(r => mergeRecordStatementsByStrategy('reputation','we_reputation','axis_key',r,round,['axis_key','axis_name','level','verdict','evidence','last_change','updated_round'], { level: '普通' }, strategyMap))],
    ['economy', () => (result.economy || []).flatMap(r => mergeRecordStatementsByStrategy('economy','we_economy','economy_key',r,round,['economy_key','scope','climate','signal','cause','impact','expires_round','updated_round'], {}, strategyMap))],
    ['enemies', () => (result.enemies || []).flatMap(r => mergeRecordStatementsByStrategy('enemies','we_enemies','enemy_key',r,round,['enemy_key','name','enemy_type','grudge','severity','stage','resources','knows_user_info','current_plan','terminal','updated_round'], { severity: 1, terminal: '否' }, strategyMap))],
    ['influence_chain', () => (result.influence_chain || []).flatMap(r => mergeRecordStatementsByStrategy('influence_chain','we_influence_chain','chain_key',r,round,['chain_key','source_module','source_key','direct_effect','propagated_to','evidence','status','created_round','expires_round'], { status: 'active' }, strategyMap))],
    ['blackbox', () => (result.blackbox || []).flatMap(r => mergeRecordStatementsByStrategy('blackbox','we_blackbox','secret_key',r,round,['secret_key','category','content','owner','witnesses','traces','exposure_risk','public_status','updated_round'], { exposure_risk: 0, public_status: 'hidden' }, strategyMap))],
    ['regional_incident', () => (result.regional_incident || []).flatMap(r => mergeRecordStatementsByStrategy('regional_incident','we_regional_incident','incident_key',r,round,['incident_key','active','title','incident_type','scope','impact','remaining_rounds','cooldown','updated_round'], { active: '否', remaining_rounds: 0, cooldown: 0 }, strategyMap))],
    ['custom', () => Object.keys(result.custom || {}).flatMap(moduleId => (result.custom[moduleId] || []).map(item => upsertCustomStatement(moduleId, item, round)).filter(Boolean))],
  ];
  for (const [name, collect] of steps) {
    try { const statements = collect(); if (statements.length) await b(statements); } catch (error) { if (strictMode) { await restoreWorldSnapshotFromCheckpoint(checkpointId, 'module_merge_failed:' + name); throw error; } await writeDiagnostic('module_merge_warning', { module: name, error: String(error?.message || error) }, round); ctx.log.warn('[World 推演器] 模块合并失败，已跳过: ' + name + ' - ' + String(error?.message || error)); }
  }
}
function hasEffectiveWorldChanges(result) {
  if (result.world_digest && Object.keys(result.world_digest || {}).length) return true;
  for (const key of ['events','factions','winds','reputation','economy','enemies','influence_chain','blackbox','regional_incident']) if (Array.isArray(result[key]) && result[key].length) return true;
  return !!(result.custom && typeof result.custom === 'object' && Object.keys(result.custom).some(k => Array.isArray(result.custom[k]) && result.custom[k].length));
}
async function validateWorldResult(result, modules, round) {
  const enabled = new Set(modules.map(m => String(m.module_id || '')));
  const allowedTop = new Set(['world_digest','events','factions','winds','reputation','economy','enemies','influence_chain','blackbox','regional_incident','custom']);
  const warnings = [];
  for (const key of Object.keys(result)) if (!allowedTop.has(key)) { warnings.push('unknown_top_field:' + key); delete result[key]; }
  if (Array.isArray(result.events)) result.events = result.events.filter(r => r.event_key && ['conflict','progress','custom'].includes(r.event_type || 'custom') && Number(r.progress ?? 0) >= 0 && Number(r.progress ?? 0) <= 100);
  if (Array.isArray(result.winds)) result.winds = result.winds.filter(r => r.wind_key && Number(r.intensity ?? 1) >= 0 && Number(r.intensity ?? 1) <= 10);
  if (Array.isArray(result.enemies)) result.enemies = result.enemies.filter(r => r.enemy_key && Number(r.severity ?? 1) >= 1 && Number(r.severity ?? 1) <= 10);
  if (Array.isArray(result.blackbox)) result.blackbox = result.blackbox.filter(r => r.secret_key && Number(r.exposure_risk ?? 0) >= 0 && Number(r.exposure_risk ?? 0) <= 100);
  const privateSources = new Set((result.blackbox || []).map(r => String(r.secret_key || r.content || '')));
  if (Array.isArray(result.winds)) result.winds = result.winds.filter(r => r.source || !privateSources.has(String(r.content || r.topic || '')));
  if (Array.isArray(result.reputation)) result.reputation = result.reputation.filter(r => r.evidence || r.last_change);
  if (Array.isArray(result.factions)) result.factions = result.factions.filter(r => r.goal || r.resources || r.known_info || r.last_action);
  if (Array.isArray(result.enemies)) result.enemies = result.enemies.filter(r => r.knows_user_info || r.current_plan);
  if (Array.isArray(result.economy)) result.economy = result.economy.filter(r => r.cause && r.scope);
  const changedModules = ['events','factions','winds','reputation','economy','enemies','blackbox','regional_incident'].filter(k => Array.isArray(result[k]) && result[k].length);
  if (changedModules.length > 1 && (!Array.isArray(result.influence_chain) || !result.influence_chain.length)) {
    warnings.push('influence_chain_missing_for:' + changedModules.join(','));
    result.influence_chain = [{ chain_key: 'missing_chain_' + round + '_' + hashText(changedModules.join(',')), source_module: changedModules.join(','), source_key: '', direct_effect: '跨模块传导未由模型显式说明', propagated_to: '', evidence: '模型输出包含多个模块变化但缺少 influence_chain，已记录缺失原因。', status: 'active', created_round: round }];
  }
  for (const [moduleId, field] of [['events','events'],['factions','factions'],['winds','winds'],['reputation','reputation'],['economy','economy'],['enemies','enemies'],['influence_chain','influence_chain'],['blackbox','blackbox'],['regional_incident','regional_incident']]) {
    if (!enabled.has(moduleId) && result[field] !== undefined) { warnings.push('disabled_module_output:' + moduleId); delete result[field]; }
  }
  if (warnings.length) await writeDiagnostic('validation_warning', { warnings }, round);
}
function upsertCustomStatement(moduleId, item, round) {
  const key = item.item_key || item.key || item.id || item.name;
  if (!key) return null;
  return ['INSERT INTO we_custom_state (module_id,item_key,item_json,stage,verdict,score,visibility,expires_round,updated_round) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(module_id,item_key) DO UPDATE SET item_json=excluded.item_json, stage=excluded.stage, verdict=excluded.verdict, score=excluded.score, visibility=excluded.visibility, expires_round=excluded.expires_round, updated_round=excluded.updated_round', [moduleId, key, JSON.stringify(item), item.stage || null, item.verdict || null, item.score ?? null, item.visibility || 'unknown', item.expires_round ?? null, round]];
}
try { return await main(); } catch (error) { ctx.log.error('[World 推演器] 顶层异常: ' + String(error?.message || error)); throw error; }`;

const presetGeneratorSource = importWorldHelpers(['rows','q','parseJson','tableExists','b','nowText','first']) + String.raw`
async function main() {
  const mode = String(ctx.input?.mode || ctx.config?.mode || 'mixed');
  const moduleCountStrategy = String(ctx.input?.moduleCountStrategy || ctx.config?.moduleCountStrategy || 'ai');
  let worldbook = String(ctx.input?.worldbook || '');
  if (!worldbook && ctx.api.renderWorldbookForPrompt) {
    const scanText = String(ctx.input?.presetScanText || ctx.config?.presetScanText || 'World 预设生成：请返回当前角色和世界设定相关材料。');
    worldbook = String(await ctx.api.renderWorldbookForPrompt(scanText, ctx.input?.worldbookOptions || ctx.config?.worldbookOptions || {}) || '');
  }
  const roleDescription = ctx.input?.roleDescription || '';
  const fixedModuleCount = Number(ctx.input?.moduleCount || ctx.config?.moduleCount || 0);
  const existingModules = rows(q('SELECT module_id FROM we_modules'));
  const builtinFields = new Set(['world_digest','events','factions','winds','reputation','economy','enemies','influence_chain','blackbox','regional_incident','custom','row_id','module_id','item_key','item_json','stage','verdict','score','visibility','expires_round','updated_round']);
  const messages = [
    { role: 'system', content: '你生成 World 模块描述符 JSON，只输出 {"modules":[]}。不要生成代码。' },
    { role: 'user', content: '模式：' + mode + '\n模块数量策略：' + moduleCountStrategy + (fixedModuleCount > 0 ? ('，目标 ' + fixedModuleCount + ' 个') : '') + '\n已有模块：' + existingModules.map(m => m.module_id).join(',') + '\n世界书：\n' + worldbook + '\n角色设定：\n' + roleDescription + '\n输出字段需包含 module_id,module_name,kind,container,state_table,item_key,rules,output_contract,mechanics_json,display_json,lifecycle_json,merge_strategy。' },
  ];
  const raw = await ctx.api.callAI(messages, {});
  const parsed = parseJson(raw, null);
  if (!parsed || !Array.isArray(parsed.modules)) throw new Error('预设生成响应无 modules 数组');
  if (moduleCountStrategy === 'fixed' && fixedModuleCount > 0 && parsed.modules.filter(m => m && m.enabled !== '否').length !== fixedModuleCount) throw new Error('启用模块数量不等于固定数量要求');
  if (moduleCountStrategy === 'keep_existing_fill' && fixedModuleCount > 0 && parsed.modules.filter(m => m && !existingModules.some(e => e.module_id === m.module_id) && m.enabled !== '否').length > fixedModuleCount) throw new Error('补齐模块数量超过策略限制');
  const existingIds = new Set(existingModules.map(m => String(m.module_id || '')));
  const seen = new Set();
  const validModules = [];
  for (const mod of parsed.modules) {
    if (!mod.module_id || !mod.module_name) throw new Error('模块缺少 module_id 或 module_name');
    if (seen.has(mod.module_id)) throw new Error('模块 module_id 重复: ' + mod.module_id);
    seen.add(mod.module_id);
    if (existingIds.has(mod.module_id) && mod.kind !== 'builtin') throw new Error('模块 module_id 与现有模块冲突: ' + mod.module_id);
    const stateTable = mod.state_table || 'we_custom_state';
    if (stateTable !== 'we_custom_state' && !tableExists(stateTable)) throw new Error('模块 state_table 不存在: ' + stateTable);
    const outputContract = typeof mod.output_contract === 'string' ? parseJson(mod.output_contract, null) : (mod.output_contract || {});
    const fields = outputContract?.fields || outputContract || {};
    const itemKey = mod.item_key || 'item_key';
    if (mod.container !== 'none' && itemKey && typeof fields === 'object' && Object.keys(fields).length && !Object.prototype.hasOwnProperty.call(fields, itemKey)) throw new Error('模块 item_key 不在 output_contract 字段中: ' + mod.module_id);
    for (const fieldName of ['mechanics_json','display_json','lifecycle_json']) {
      const rawField = mod[fieldName] == null ? {} : mod[fieldName];
      const parsedField = typeof rawField === 'string' ? parseJson(rawField, null) : rawField;
      if (!parsedField || typeof parsedField !== 'object' || Array.isArray(parsedField)) throw new Error('模块 ' + fieldName + ' 不是合法 JSON 对象: ' + mod.module_id);
    }
    for (const field of Object.keys(fields || {})) if (builtinFields.has(field) && field !== itemKey) throw new Error('模块字段与内置状态字段冲突: ' + mod.module_id + '.' + field);
    validModules.push({ mod, outputContract, stateTable, itemKey });
  }
  const statements = [];
  for (const item of validModules) {
    const mod = item.mod;
    statements.push(['INSERT INTO we_modules (module_id,module_name,kind,enabled,container,state_table,item_key,order_no,rules,output_contract,mechanics_json,display_json,lifecycle_json,merge_strategy,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(module_id) DO UPDATE SET module_name=excluded.module_name, kind=excluded.kind, enabled=excluded.enabled, container=excluded.container, state_table=excluded.state_table, item_key=excluded.item_key, rules=excluded.rules, output_contract=excluded.output_contract, mechanics_json=excluded.mechanics_json, merge_strategy=excluded.merge_strategy, updated_at=excluded.updated_at', [mod.module_id, mod.module_name, mod.kind || 'custom', '是', mod.container || 'array', mod.state_table || 'we_custom_state', mod.item_key || 'item_key', Number(mod.order_no || 200), mod.rules || '', JSON.stringify(mod.output_contract || {}), JSON.stringify(mod.mechanics_json || {}), JSON.stringify(mod.display_json || {}), JSON.stringify(mod.lifecycle_json || {}), mod.merge_strategy || 'upsert', nowText()]]);
    if (Array.isArray(mod.initial_state)) {
      const round = Number(first('SELECT round FROM we_meta LIMIT 1')?.round || 0);
      for (const state of mod.initial_state) {
        const key = state.item_key || state.key || state.id || state.name;
        if (!key) continue;
        statements.push(['INSERT INTO we_custom_state (module_id,item_key,item_json,stage,verdict,score,visibility,expires_round,updated_round) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(module_id,item_key) DO UPDATE SET item_json=excluded.item_json, stage=excluded.stage, verdict=excluded.verdict, score=excluded.score, visibility=excluded.visibility, expires_round=excluded.expires_round, updated_round=excluded.updated_round', [mod.module_id, key, JSON.stringify(state), state.stage || null, state.verdict || null, state.score ?? null, state.visibility || 'unknown', state.expires_round ?? null, round]]);
      }
    }
  }
  if (statements.length) await b(statements);
  return { ok: true, count: validModules.length };
}
try { return await main(); } catch (error) { ctx.log.error('[World 预设生成器] 顶层异常: ' + String(error?.message || error)); throw error; }`;

const synchronizerSource = importWorldHelpers(['rows','q','first','tableExists','m','b','safeJson','buildWorldSnapshot','nowText','restoreWorldSnapshotFromCheckpoint','insertIfMissingSql']) + String.raw`
function tableColumns(table) { return rows(q('PRAGMA table_info(' + table + ')')).map(r => r.name); }
function pickExisting(row, columns) {
  const picked = {};
  for (const key of Object.keys(row)) if (columns.includes(key) && row[key] !== undefined) picked[key] = row[key];
  return picked;
}
function safeInsertDefaultTableStatement(table, row) {
  const columns = tableColumns(table).filter(c => c !== 'row_id');
  const picked = pickExisting(row, columns);
  const writeCols = Object.keys(picked);
  if (!writeCols.length) return null;
  return ['INSERT INTO ' + table + ' (' + writeCols.join(',') + ') VALUES (' + writeCols.map(() => '?').join(',') + ')', writeCols.map(c => picked[c])];
}
async function main() {
  const round = Number(first('SELECT round FROM we_meta LIMIT 1')?.round || 0);
  const importantTable = tableExists('important_non_romance') ? 'important_non_romance' : (tableExists('important_characters') ? 'important_characters' : '');
  const synced = [];
  const strictMode = ctx.config?.strictMode === true;
  const beforeSyncCheckpointId = 'sync_before_' + Date.now();
  if (strictMode) await m('INSERT INTO we_checkpoints (checkpoint_id,round,message_id,snapshot_json,reason,created_at) VALUES (?,?,?,?,?,?)', [beforeSyncCheckpointId, round, null, safeJson(buildWorldSnapshot(), {}), 'before_synchronizer', nowText()]);
  try {
    const statements = [];
    const events = rows(q("SELECT event_key, title, current_state, visibility FROM we_events WHERE visibility IN ('public','rumor') AND terminal='否' ORDER BY updated_round DESC LIMIT 5"));
    if (tableExists('quests_events')) {
      for (const event of events) {
        const name = event.title || event.event_key;
        const existed = first('SELECT row_id FROM quests_events WHERE quest_name=? OR event_name=? LIMIT 1', [name, name]);
        if (!existed) {
          const columns = Object.keys(first('SELECT * FROM quests_events LIMIT 1') || { row_id: null, quest_name: null, status: null }).filter(c => c !== 'row_id');
          const row = {};
          for (const c of columns) row[c] = c.includes('name') ? name : (c.includes('status') ? '公开' : (c.includes('desc') || c.includes('description') ? event.current_state || '' : ''));
          const writeCols = Object.keys(row);
          if (writeCols.length) statements.push(['INSERT INTO quests_events (' + writeCols.join(',') + ') VALUES (' + writeCols.map(() => '?').join(',') + ')', writeCols.map(c => row[c])]);
          synced.push('quest:' + name);
        }
      }
    }
    const exposed = rows(q("SELECT secret_key, category, content, owner, traces FROM we_blackbox WHERE public_status='exposed' ORDER BY updated_round DESC LIMIT 10"));
    for (const secret of exposed) {
      if (!String(secret.traces || '').trim()) { synced.push('blackbox_skip_no_evidence:' + secret.secret_key); continue; }
      statements.push(insertIfMissingSql('we_winds', 'wind_key', 'exposed_' + secret.secret_key, ['wind_key','topic','content','source','channel','scope','credibility','intensity','decay_rounds','visible_to_user','updated_round'], ['exposed_' + secret.secret_key, '秘密曝光', secret.content, secret.owner || '未知', '暴露线索', '', '未证实', 5, 3, '是', round]));
      statements.push(insertIfMissingSql('we_events', 'event_key', 'exposed_' + secret.secret_key, ['event_key','title','event_type','stage','progress','scope','actors','cause','current_state','visibility','terminal','updated_round'], ['exposed_' + secret.secret_key, '秘密曝光', 'progress', '公开', 100, '', secret.owner || '', secret.traces || '', secret.content || '', 'public', '是', round]));
      synced.push('blackbox:' + secret.secret_key);
    }
    if (tableExists('global_state')) {
      const publicIncident = first("SELECT scope FROM we_regional_incident WHERE active='是' AND scope IS NOT NULL ORDER BY updated_round DESC LIMIT 1");
      if (publicIncident?.scope) {
        const parts = String(publicIncident.scope).split(/[\/／,，;；]/).map(s => s.trim()).filter(Boolean);
        const columns = tableColumns('global_state');
        const updates = [];
        const params = [];
        if (parts[0] && columns.includes('current_major_region')) { updates.push('current_major_region=?'); params.push(parts[0]); }
        if (parts[1] && columns.includes('current_minor_region')) { updates.push('current_minor_region=?'); params.push(parts[1]); }
        if (parts[2] && columns.includes('current_location')) { updates.push('current_location=?'); params.push(parts[2]); }
        if (updates.length) { params.push(1); statements.push(['UPDATE global_state SET ' + updates.join(', ') + ' WHERE row_id=?', params]); }
        synced.push('global_state:' + publicIncident.scope);
      }
    }
    if (importantTable) {
      const publicActors = rows(q("SELECT faction_key, name, type, status, relation_to_user, last_action FROM we_factions WHERE (last_action IS NOT NULL AND last_action<>'') OR relation_to_user IS NOT NULL ORDER BY updated_round DESC LIMIT 5"));
      const importantColumns = tableColumns(importantTable);
      const nameColumn = ['name','character_name','npc_name','char_name'].find(c => importantColumns.includes(c));
      for (const actor of publicActors) {
        const name = actor.name || actor.faction_key;
        const existed = nameColumn ? first('SELECT row_id FROM ' + importantTable + ' WHERE ' + nameColumn + '=? LIMIT 1', [name]) : null;
        if (existed) continue;
        const statement = safeInsertDefaultTableStatement(importantTable, { name, character_name: name, npc_name: name, type: actor.type || '势力人物', status: actor.status || '', relationship: actor.relation_to_user || '', description: actor.last_action || '', note: actor.last_action || '' });
        if (statement) { statements.push(statement); synced.push('important_character:' + name); }
      }
    }
    statements.push(["INSERT INTO we_ledger (request_id,round,status,prompt_digest,parsed_json,started_at,finished_at) VALUES (?,?,?,?,?,?,?)", ['sync_' + Date.now(), round, 'success', 'World 同步器', JSON.stringify({ synced }), nowText(), nowText()]]);
    await b(statements);
    return { ok: true, synced };
  } catch (error) {
    const message = String(error?.message || error);
    ctx.log.error('[World 同步器] 回流失败: ' + message);
    if (strictMode) await restoreWorldSnapshotFromCheckpoint(beforeSyncCheckpointId, 'synchronizer_failed');
    await m("INSERT INTO we_ledger (request_id,round,status,prompt_digest,error,started_at,finished_at) VALUES (?,?,?,?,?,?,?)", ['sync_' + Date.now(), round, 'failed', 'World 同步器', message, nowText(), nowText()]);
    return { ok: false, error: message };
  }
}
try { return await main(); } catch (error) { ctx.log.error('[World 同步器] 顶层异常: ' + String(error?.message || error)); throw error; }`;

const restorerSource = importWorldHelpers(['first','parseJson','validateWorldSnapshot','buildWorldSnapshot','safeJson','m','b','nowText','restoreWorldSnapshotRows','restoreWorldSnapshotFromCheckpoint','previewWorldMechanics']) + String.raw`
async function main() {
  const checkpointId = String(ctx.input?.checkpoint_id || ctx.config?.checkpoint_id || '').trim();
  if (!checkpointId) throw new Error('缺少 checkpoint_id');
  const checkpoint = first('SELECT * FROM we_checkpoints WHERE checkpoint_id=?', [checkpointId]);
  if (!checkpoint) throw new Error('未找到 checkpoint: ' + checkpointId);
  const snapshot = parseJson(checkpoint.snapshot_json, null);
  validateWorldSnapshot(snapshot);
  const emergencyCheckpointId = 'emergency_before_restore_' + Date.now();
  const emergency = buildWorldSnapshot();
  await m('INSERT INTO we_checkpoints (checkpoint_id,round,message_id,snapshot_json,reason,created_at) VALUES (?,?,?,?,?,?)', [emergencyCheckpointId, Number(checkpoint.round || 0), checkpoint.message_id || null, safeJson(emergency, {}), 'before_restore', nowText()]);
  try {
    await restoreWorldSnapshotRows(snapshot);
  } catch (restoreError) {
    await restoreWorldSnapshotFromCheckpoint(emergencyCheckpointId, 'restore_failed');
    await m("INSERT INTO we_ledger (request_id,round,message_id,status,prompt_digest,error,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?)", ['restore_failed_' + Date.now(), Number(checkpoint.round || 0), checkpoint.message_id || null, 'failed', 'World 恢复器', String(restoreError?.message || restoreError), nowText(), nowText()]);
    throw restoreError;
  }
  const mechanicsPreview = previewWorldMechanics(Number(checkpoint.round || 0), 'restorer');
  if (ctx.api.refreshDataAndWorldbook) await ctx.api.refreshDataAndWorldbook();
  await b([
    ['UPDATE we_meta SET last_message_id=?, last_checkpoint_id=?, updated_at=? WHERE row_id=1', [checkpoint.message_id || null, checkpointId, nowText()]],
    ["INSERT INTO we_ledger (request_id,round,message_id,status,prompt_digest,parsed_json,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?)", ['restore_' + Date.now(), Number(checkpoint.round || 0), checkpoint.message_id || null, 'success', 'World 恢复器', JSON.stringify({ checkpoint_id: checkpointId, mechanicsPreview }), nowText(), nowText()]],
  ]);
  return { ok: true, checkpoint_id: checkpointId };
}
try { return await main(); } catch (error) { ctx.log.error('[World 恢复器] 顶层异常: ' + String(error?.message || error)); throw error; }`;

export function buildWorldScriptPackage() {
  const worldLibraryNames = [WORLD_HELPERS_LIBRARY_NAME];
  return {
    format: WORLD_SCRIPT_PACKAGE_FORMAT,
    libraries: [
      library({ name: WORLD_HELPERS_LIBRARY_NAME, description: 'World 脚本共享公共方法库。', source: worldHelpersLibrarySource }),
    ],
    scripts: [
      script({ name: 'World 初始化器', description: '初始化 World 元数据、内置模块、默认 prompt、声誉轴和第 0 轮摘要。', source: initializerSource, bindings: [binding('chat.loaded', 10), binding('db.loaded', 10)], order: 10, libraryNames: worldLibraryNames }),
      script({ name: 'World 推演器', description: '在正文回复后读取默认表和 World 后台表，调用 AI 推进世界状态。', source: evolverSource, bindings: [binding('main_reply.after_response', 20)], order: 20, libraryNames: worldLibraryNames }),
      script({ name: 'World 摘要器', description: '从后台状态生成可注入正文的 we_world_digest 摘要。', source: summarizerSource, bindings: [], order: 30, libraryNames: worldLibraryNames }),
      script({ name: 'World 世界书读取器', description: '构造 World 推演扫描文本并调用正式世界书渲染链路。', source: worldbookReaderSource, bindings: [], order: 40, libraryNames: worldLibraryNames }),
      script({ name: 'World 机制执行器', description: '执行风声衰减、区域事件冷却、影响链过期等确定性机制。', source: mechanicsSource, bindings: [], order: 50, libraryNames: worldLibraryNames }),
      script({ name: 'World 同步器', description: '将公开且可见的 World 后台结果回流到默认前台表。', source: synchronizerSource, bindings: [], order: 60, libraryNames: worldLibraryNames }),
      script({ name: 'World 预设生成器', description: '根据世界书和角色描述生成 we_modules 模块描述符。', source: presetGeneratorSource, bindings: [], order: 70, defaultVariableInput: { mode: 'mixed', worldbook: '', roleDescription: '' }, libraryNames: worldLibraryNames }),
      script({ name: 'World 恢复器', description: '按 we_checkpoints 存档点恢复 World 后台状态。', source: restorerSource, bindings: [], order: 80, defaultVariableInput: { checkpoint_id: '' }, libraryNames: worldLibraryNames }),
    ],
  };
}

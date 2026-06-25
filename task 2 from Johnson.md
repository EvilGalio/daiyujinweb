# 材质查表

具体来说，我需要构建所有我们提供的材料的各国标准替换牌号，比如ISO的Al-Zn6MgCu，对应EN的EN AW7075，DIN (Germany)的3.4365等等，需要有ISO、EN、DIN (Germany)、ANSI/AA (USA)、BS (Great Britain)、AFNOR (France)、UNE (Spain)、UNS、JIS (Japan)、CSA (Canada)、SIS (Sweden)，材料大概包括

**Common Metal Materials**

* Aluminum alloys (6061, 7075)
* Stainless steel (303, 304, 316)
* Carbon steel
* Alloy steel
* Titanium
* Brass
* Copper

**Engineering Plastics**

* POM (Delrin)
* Nylon (PA)
* PTFE (Teflon)
* PEEK
* ABS
* Polycarbonate

**Plastic Materials**

* ABS
* PP
* PC
* Nylon (PA)
* PBT
* TPU
* PEEK

**Die Casting Materials**

* Aluminum alloys
* Zinc alloys
* Magnesium alloys

  **Structural Metals**

  * Carbon steel
  * Stainless steel
  * Aluminum
  * Alloy steel
  * Titanium

  **Sheet Metal Materials**

  * Stainless steel
  * Aluminum
  * Galvanized steel
  * Carbon steel

  **Specialized Materials**

  * High-temperature alloys
  * Wear-resistant materials
  * Corrosion-resistant alloys

总的来说有这么些材料，每种材料内部也有可能有很多不同的材质，比如Aluminum就有Al-Zn6MgCu、AlZn5Mg3Cu、Al-Zn4,5Mg1、Al-Si1Mg、Al-Mg1SiCu等等几十种。我需要的是一个系统，用户在其中搜一个标准牌照，比如搜一个EN AW7075（可能不完整，如7075、AW7075等），一行输出这个材料的各国标准牌照。做的话，需要派subagent先根据我的需求，对每种材料种的每种材质去网上搜索各国标准牌照并存成表，然后做一个查询返回。

# 材料计算器

参考https://www.onlinemetals.com/en/weight-calculator?srsltid=AfmBOorKmOYaQxAJ1uI17LuWvlgkjbIEdLlDcFXnXgjMrr0j5SZdZQSI，我们也要做一个这样的计算器。Enter Material and quantity below，包括材料及alloy、形状（参考它的），它还有svg参考图，然后输入size information，就可以计算重量。

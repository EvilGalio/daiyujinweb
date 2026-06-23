# 报价计算器

我作为精密材料提供商，在网页中实现一个计算器：客户在我的网站中上传STP文件，上传后进行解析，可以用我们之前“D:\dyj-scrapling\ReadStep"中做的逻辑，使用OCC进行处理，输入是STP文件（单个），第一段输出是一个框，里面包括零件的图片、尺寸、重量信息，以及复选框，让客户手动选择材质（影响前面的质量信息）、公差、后处理等等，然后选择完之后的确定按钮，点击则通过数学计算（重量*材料成本 *公差系数 *后处理系数等等等等），计算出一个报价（默认USD，用户可选货币，做一个汇率转换）提供给客户。

# 国家重量运费计算器

作为外贸公司，做跨国生意时当然需要考虑运费。根据D重量运费.xlsx，将excel中计算DHL和FedEX的运费计算封装成一个计算器，嵌到我的网页中去。用户输入的是国家、重量，我们输出的是运费（根据用户输入的国家选择货币，亦提供可选货币）。

# 公差计算展示

参考优秀同行的网页https://www.machiningdoctor.com/calculators/tolerances/#charts和https://www.machiningdoctor.com/calculators/tolerances/#calc，进行Tolerance查询，用户输入**Basic Size**和**Fit Combination**之后得出

**Shaft 25 mm k5******

**Limits of Size**[ ]

**Tolerance Field (IT)**[ ]

**ei**[ ]

**es**[ ]

**Bore 25 mm H6******

**Limits of Size**[ ]

**Tolerance Field (IT)**[ ]

**EI**[ ]

**ES**[ ]

**Fit 25 mm H6/k5******

**Fit Type**[ ]

**Max. Clearance**[ ]

**Max. Interference**[ ]

总之跟https://www.machiningdoctor.com/calculators/tolerances/#calc的逻辑和功能实现基本一致，只是设计上有我们的讲究。

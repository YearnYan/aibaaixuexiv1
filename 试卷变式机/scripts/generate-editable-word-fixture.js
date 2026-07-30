'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createEditableWordDocument } = require('../shared/editable-word-export');

const groups = {
    choice: {
        title: '一、全学科规范公式选择题',
        items: [
            {
                index: 1,
                stem: String.raw`【数学】二次方程的求根公式为 \(x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}\)，且 \(\Delta=b^2-4ac\)。`,
                options: [String.raw`A. \(\Delta>0\)`, String.raw`B. \(\Delta=0\)`, String.raw`C. \(\Delta<0\)`],
                originalIdx: 0
            },
            {
                index: 2,
                stem: String.raw`【物理】质点满足 \(v=v_0+at\)，动能为 \(E_k=\frac12mv^2\)，速度单位为 \(\mathrm{m/s}\)。`,
                options: [],
                originalIdx: 1
            },
            {
                index: 3,
                stem: String.raw`【化学】写出离子反应：\(\ce{SO4^2- + Ba^2+ -> BaSO4 v}\)，并标出 \(\pu{0.10 mol L^{-1}}\)。`,
                options: [],
                originalIdx: 2
            },
            {
                index: 4,
                stem: String.raw`【生物】种群指数增长模型为 \(N_t=N_0e^{rt}\)，半衰期模型为 \(N_t=N_0\left(\frac12\right)^{t/T_{1/2}}\)。`,
                options: [],
                originalIdx: 3
            },
            {
                index: 5,
                stem: String.raw`【地理】相对高度可估算为 \(H=1000\frac{P_1-P_2}{\rho g}\)，温差为 \(\Delta T=T_d-T_w\)。`,
                options: [],
                originalIdx: 4
            }
        ]
    },
    calculation: {
        title: '二、综合计算与结构表达',
        items: [
            {
                index: 6,
                stem: String.raw`解方程组：\[\begin{cases}x+y=3\\2x-y=0\end{cases}\]`,
                options: [],
                originalIdx: 5
            },
            {
                index: 7,
                stem: String.raw`计算矩阵与积分：\[A=\begin{pmatrix}1&2\\3&4\end{pmatrix},\qquad I=\int_0^{\infty}e^{-x^2}\,dx\]`,
                options: [],
                originalIdx: 6
            },
            {
                index: 8,
                stem: '兼容旧文本写法：H2O、CO2、x^2、v_0、SO₄²⁻ 仍必须保持可编辑上下标。',
                options: [],
                originalIdx: 7
            }
        ]
    }
};

const answers = [
    String.raw`1. 依据 \(\Delta=b^2-4ac\) 判断根的情况。`,
    String.raw`2. 使用 \(v=v_0+at\) 与 \(E_k=\frac12mv^2\)。`,
    String.raw`3. \(\ce{SO4^2- + Ba^2+ -> BaSO4 v}\)。`,
    String.raw`4. \(N_t=N_0e^{rt}\)。`,
    String.raw`5. \(H=1000\frac{P_1-P_2}{\rho g}\)。`,
    String.raw`6. \(x=1,\ y=2\)。`,
    String.raw`7. 矩阵与积分均按题干中的原生公式编辑。`,
    '8. 所有上下标均为 Word 可编辑文本格式。'
];

async function main() {
    const result = await createEditableWordDocument({
        title: '试卷变式机全学科可编辑公式验收试卷',
        groups,
        answers,
        showAnswer: true,
        figureImages: new Map()
    });
    const outputDirectory = path.resolve(__dirname, '../../output/doc');
    const outputPath = path.join(outputDirectory, '试卷变式机-全学科可编辑公式验收.docx');
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(outputPath, result.bytes);
    console.log(JSON.stringify({
        outputPath,
        formulaCount: result.formulaCount,
        figureCount: result.figureCount,
        bytes: result.bytes.length
    }));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

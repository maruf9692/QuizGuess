
"use strict";

// Check whether PDF.js loaded successfully
if (typeof pdfjsLib === "undefined") {
    alert(
        "PDF.js did not load. Check your internet connection " +
        "and the PDF.js script in index.html."
    );
} else {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

// Get HTML elements
const pdfFile = document.getElementById("pdfFile");
const fileName = document.getElementById("fileName");
const startBtn = document.getElementById("startBtn");
const uploadMessage = document.getElementById("uploadMessage");

const uploadSection = document.querySelector(".upload-section");
const quizSection = document.getElementById("quizSection");
const resultSection = document.getElementById("resultSection");

const questionCounter = document.getElementById("questionCounter");
const questionText = document.getElementById("questionText");
const optionsContainer = document.getElementById("optionsContainer");
const nextBtn = document.getElementById("nextBtn");
const restartBtn = document.getElementById("restartBtn");

// Quiz data
let questions = [];
let currentIndex = 0;
let userAnswers = [];

// 1. Handle PDF upload
pdfFile.addEventListener("change", async function () {
    const file = pdfFile.files[0];

    startBtn.disabled = true;
    uploadMessage.textContent = "";
    questions = [];

    if (!file) {
        fileName.textContent = "No file selected";
        return;
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
        uploadMessage.textContent = "Please select a PDF file.";
        return;
    }

    if (typeof pdfjsLib === "undefined") {
        uploadMessage.textContent =
            "PDF.js is not loaded. Check index.html and your internet connection.";
        return;
    }

    fileName.textContent = file.name;
    uploadMessage.textContent = "Reading PDF...";

    try {
        const lines = await extractPDFLines(file);

        questions = parseQuestions(lines);

        if (questions.length === 0) {
            uploadMessage.textContent =
                "No question-answer pairs were detected. Check the PDF format.";
            return;
        }

        if (questions.length < 4) {
            uploadMessage.textContent =
                "At least 4 usable questions are needed to create MCQ options.";
            questions = [];
            return;
        }

        uploadMessage.textContent =
            `${questions.length} questions found. Ready to start!`;

        startBtn.disabled = false;
    } catch (error) {
        console.error("PDF reading error:", error);
        uploadMessage.textContent =
            "Could not read the PDF. Check the browser console for details.";
    }
});

// 2. Extract PDF text while preserving line positions
async function extractPDFLines(file) {
    const data = new Uint8Array(await file.arrayBuffer());

    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const allLines = [];

    for (let pageNumber = 1;
         pageNumber <= pdf.numPages;
         pageNumber++) {

        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();

        const lineMap = new Map();

        for (const item of content.items) {
            if (!item.str || !item.str.trim()) continue;

            const x = item.transform[4];
            const y = Math.round(item.transform[5] * 2) / 2;

            if (!lineMap.has(y)) {
                lineMap.set(y, []);
            }

            lineMap.get(y).push({ x, text: item.str });
        }

        // PDF coordinates start at the bottom, so sort top to bottom.
        const pageLines = [...lineMap.entries()]
            .sort((a, b) => b[0] - a[0])
            .map(([y, items]) => {
                items.sort((a, b) => a.x - b.x);

                const text = items
                    .map(item => item.text.trim())
                    .filter(Boolean)
                    .join(" ")
                    .replace(/\s+/g, " ")
                    .trim();

                return {
                    y,
                    x: Math.min(...items.map(item => item.x)),
                    text
                };
            })
            .filter(line => line.text);

        allLines.push(...pageLines);
    }

    return allLines;
}

// 3. Parse numbered questions and their answers
function parseQuestions(lines) {
    const parsed = [];
    let current = null;

    // The PDF uses formats such as "1)" or "1."
    const questionStart = /^\s*(\d+)\s*[.)]\s*(.*)$/;

    function saveCurrent() {
        if (!current) return;

        const question = current.questionLines
            .map(line => line.text)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

        const answer = current.answerLines
            .map(line => line.text)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

        if (question && answer) {
            parsed.push({
                number: current.number,
                question,
                answer
            });
        }
    }

    for (const line of lines) {
        const match = line.text.match(questionStart);

        if (match) {
            saveCurrent();

            current = {
                number: Number(match[1]),
                startX: line.x,
                questionLines: [
                    { ...line, text: match[2].trim() }
                ],
                answerLines: [],
                answerStarted: false
            };

            continue;
        }

        if (!current) continue;

        // In this PDF, answers are generally indented farther
        // than the question number and question text.
        const isIndentedAnswer =
            line.x > current.startX + 30;

        if (isIndentedAnswer) {
            current.answerStarted = true;
        }

        if (current.answerStarted) {
            current.answerLines.push(line);
        } else {
            current.questionLines.push(line);
        }
    }

    saveCurrent();

    // Remove incomplete or duplicate question numbers.
    const seen = new Set();

    return parsed.filter(question => {
        if (!question.question || !question.answer) return false;
        if (seen.has(question.number)) return false;

        seen.add(question.number);
        return true;
    });
}

// 4. Generate options using answers from this PDF only
function prepareQuiz(parsedQuestions) {
    const answerPool = [
        ...new Set(parsedQuestions.map(q => q.answer))
    ];

    return parsedQuestions.map(question => {
        const distractors = answerPool
            .filter(answer => answer !== question.answer)
            .sort(() => Math.random() - 0.5)
            .slice(0, 3);

        const options = [
            question.answer,
            ...distractors
        ].sort(() => Math.random() - 0.5);

        return {
            ...question,
            options,
            correctAnswer: question.answer
        };
    });
}

// 5. Start the quiz
startBtn.addEventListener("click", function () {
    if (questions.length < 4) return;

    questions = prepareQuiz(questions);
    currentIndex = 0;
    userAnswers = new Array(questions.length).fill(null);

    uploadSection.hidden = true;
    resultSection.hidden = true;
    quizSection.hidden = false;

    showQuestion();
});

// 6. Display a question
function showQuestion() {
    const question = questions[currentIndex];

    questionCounter.textContent =
        `Question ${currentIndex + 1} of ${questions.length}`;

    questionText.textContent = question.question;
    optionsContainer.replaceChildren();
    nextBtn.disabled = true;

    question.options.forEach((option, index) => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "option";
        button.textContent =
            `${String.fromCharCode(65 + index)}. ${option}`;

        button.addEventListener("click", function () {
            userAnswers[currentIndex] = option;

            optionsContainer
                .querySelectorAll(".option")
                .forEach(item => {
                    item.classList.remove("selected");
                    item.disabled = true;
                });

            button.classList.add("selected");
            nextBtn.disabled = false;
        });

        optionsContainer.appendChild(button);
    });

    nextBtn.textContent =
        currentIndex === questions.length - 1
            ? "Finish Quiz"
            : "Next Question";
}

// 7. Next question
nextBtn.addEventListener("click", function () {
    if (userAnswers[currentIndex] === null) return;

    if (currentIndex < questions.length - 1) {
        currentIndex++;
        showQuestion();
    } else {
        showResults();
    }
});

// 8. Calculate results
function showResults() {
    let correct = 0;

    questions.forEach((question, index) => {
        if (userAnswers[index] === question.correctAnswer) {
            correct++;
        }
    });

    document.getElementById("totalQuestions").textContent =
        questions.length;

    document.getElementById("correctAnswers").textContent =
        correct;

    document.getElementById("wrongAnswers").textContent =
        questions.length - correct;

    document.getElementById("finalScore").textContent =
        `${correct} / ${questions.length}`;

    const review = document.getElementById("answerReview");
    review.replaceChildren();

    const heading = document.createElement("h3");
    heading.textContent = "Answer Review";
    review.appendChild(heading);

    questions.forEach((question, index) => {
        const item = document.createElement("div");
        item.className = "review-item";

        const title = document.createElement("p");
        title.textContent =
            `Q${index + 1}. ${question.question}`;

        const yourAnswer = document.createElement("p");
        yourAnswer.textContent =
            `Your answer: ${userAnswers[index]}`;

        yourAnswer.className =
            userAnswers[index] === question.correctAnswer
                ? "correct"
                : "wrong";

        const correctAnswer = document.createElement("p");
        correctAnswer.className = "correct";
        correctAnswer.textContent =
            `Correct answer: ${question.correctAnswer}`;

        item.append(title, yourAnswer, correctAnswer);
        review.appendChild(item);
    });

    quizSection.hidden = true;
    resultSection.hidden = false;
}

// 9. Restart
restartBtn.addEventListener("click", function () {
    currentIndex = 0;
    userAnswers = [];
    questions = [];

    resultSection.hidden = true;
    quizSection.hidden = true;
    uploadSection.hidden = false;

    pdfFile.value = "";
    fileName.textContent = "No file selected";
    uploadMessage.textContent = "";
    startBtn.disabled = true;
});

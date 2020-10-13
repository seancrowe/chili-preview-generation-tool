const inquirer = require("inquirer");
const {ChiliConnector} = require("chiliconnector");
const {readFileSync, existsSync, writeFileSync, createWriteStream} = require("fs");
const {ensureDirSync, emptyDirSync} = require("fs-extra");
const axios = require("axios");
const {v4} = require("uuid");

let environment = null;
let url = null;
let apiKey = null;

(async () => {

    let config = {};

    if (existsSync("./config.json")) {
        try {
            configStr = readFileSync("./config.json", "utf8");

            config = JSON.parse(configStr);
        }
        catch (e) {}
    }

    /**
     *
     * @type {ChiliConnector}
     */
    let connector = null;

    if (config != null && config.url != null) {
        url = config.url;
        connector = await verifyUrl(url);
    }

    while (connector == null) {
        url = (await getUrl()).url;
        connector = await verifyUrl(url);

        if (!connector) {
            console.log("\n*******************************************************");
            console.log("Unable to connect to API");
            console.log("********************************************************")
            console.log(`Type this into your browser: ${url}/version.xml`);
            console.log(`If you do not see <version name="x.x.x" build="x" internalBuild="xxxx" warningLabel=""/> then this is the wrong URL`);
            console.log("\n");
        }

    }

    if (config != null && config.environment != null && config.username != null && config.password != null) {
        const response = await getAPIKey(connector, {
            environment: config.environment,
            username: config.username,
            password: config.password
        });

        if (response.error === false) {
            apiKey = response.apiKey;
            environment = config.environment;
        }
    }

    while (apiKey == null) {
        const credentials = await getCredentials();
        const response = await getAPIKey(connector, credentials);

        if (response.error === true) {

            console.log("\n*******************************************************");
            console.log("Error generating API key");
            console.log("********************************************************")
            console.log(`Error message:`);
            console.log(response.message);
            console.log("\n");
        }
        else {
            apiKey = response.apiKey;
            environment = credentials.environment;
        }

    }

    let currentDirectory = ["."];

    while (true) {
        currentDirectory = await directoryCommandLine(currentDirectory, connector, apiKey);
        //console.log(currentDirectory);
    }

})();


async function getUrl() {
    return await inquirer.prompt([
        {
            type: "input",
            name: "url",
            message: "What is the CHILI URL?"
        }
    ]);
}

async function verifyUrl(url) {
    const connector = new ChiliConnector(url);

    try {
        const response = await connector.getServerDateAsync();

        if (response.date != null) {
            return connector;
        }
    }
    catch (e) {
        //console.log(e);
    }

    return null;
}

async function getCredentials() {
    return await inquirer.prompt([
        {
            type: "input",
            name: "environment",
            message: "What is the environment name?"
        },
        {
            type: "input",
            name: "username",
            message: "What is your username?"
        },
        {
            type: "password",
            name: "password",
            message: "What is your password?",
            mask: true
        }
    ]);
}

/**
 *
 * @param connector {ChiliConnector}
 */
async function getAPIKey(connector, credentials) {
    try {
        const response = await connector.generateApiKeyAsync(credentials.environment, credentials.username, credentials.password);

        if (response.apiKey.attr.succeeded == "true") {

            return {
                error: false,
                apiKey: response.apiKey.attr.key
            }
        }
        else {
            return{
                error: true,
                message: response.apiKey.attr.errorMessage
            }
        }
    }
    catch (e) {
        return{
            error: true,
            message: "Web error - something is very wrong and this probably will not work"
        }
    }

}

/**
 *
 * @param connector {ChiliConnector}
 */
async function getDirectoryPreviews(connector, apiKey, parentDirectory) {

    // const taskXML = (await inquirer.prompt([
    //     {
    //         type: "confirm",
    //         name: "task",
    //         message: "Do you want to make these previews with task XMLs (async=true)?"
    //     }
    // ])).task;

    const copyDocument = (await inquirer.prompt([
        {
            type: "confirm",
            name: "copy",
            message: "Do you want to copy the documents first?"
        }
    ])).copy;

    const async = (await inquirer.prompt([
        {
            type: "confirm",
            name: "async",
            message: "Do you want to request all pages at once (async)?"
        }
    ])).async;

    const autoGeneration = (await inquirer.prompt([
        {
            type: "confirm",
            name: "autogen",
            message: "Do you want auto preview generation on?"
        }
    ])).autogen;

    const previewType = (await inquirer.prompt([
        {
            type: "list",
            name: "type",
            choices: ["highest", "full", "thumb"],
            message: "Preview Type?"
        }
    ])).type;


    await connector.setAutomaticPreviewGenerationAsync(apiKey, autoGeneration);


    const fileIds = await getFileIdsInDirectory(connector, apiKey, parentDirectory);

    for (let i = 0; i < fileIds.length; i++) {
        const fileId = fileIds[i];
        await getPreview(connector, fileId, false, previewType, copyDocument, async);
    }

    console.log("");

}

async function getPreview(connector, documentId, taskXML = false, previewType = "full", copyDocument = false, async = true) {

    if (copyDocument) {
        const response = await connector.resourceItemCopyAsync(apiKey, "Documents", documentId, v4(), "00Copy/" + (new Date()).getFullYear() + "/" + (new Date()).getDate());
        documentId = response.item.attr.id;
    }

    const response = await connector.resourceItemGetDefinitionXMLAsync(apiKey, "Documents", documentId);

    const name = response.item.attr.name;
    const pages = response.item.fileInfo.metaData.item[0].attr.value;

    console.log("");
    console.log(`Processing ${name}`);

    const directory = `./output/${documentId}`;

    emptyDirSync(directory);

    const pagePreviews = [];

    writeFileSync(`${directory}/count ${pages}.txt`, name);

    for (let i = 0; i < pages; i++) {
        const previewUrl = `${url}/${environment}/download.aspx?page=${i}&apiKey=${apiKey}&resourceName=Documents&type=${previewType}&id=${documentId}&async=false`;

        if (async) {
            pagePreviews.push(downloadPreviewUrl(previewUrl, `${directory}/${i + 1}.png`));
        }
        else {
            await downloadPreviewUrl(previewUrl, `${directory}/${i + 1}.png`);
        }
    }

    if (async) {
        await Promise.allSettled(pagePreviews);
    }

}

async function downloadPreviewUrl(url, path) {
    const response = await axios.get(url, {timeout: 900000, responseType: 'stream'});

    const writer = createWriteStream(path);

    response.data.pipe(writer);

    await new Promise(resolve => {
        writer.on("finish", ()=>{resolve()})
    });


    //writeFileSync(path, response.data, {encoding: "binary"});
    return true;
}


/**
 *
 * @param connector {ChiliConnector}
 */
async function getFileIdsInDirectory(connector, apiKey, parentFolder) {
    const treeRes = await connector.resourceGetTreeLevelAsync(apiKey, "Documents", parentFolder, 1);

    const tree =  treeRes.tree.item;

    let fileIds = [];

    if (tree != null) {
        tree.forEach(item => {
            if (item.attr.isFolder != "true") {
                fileIds.push(item.attr.id);
            }
        });
    }

    return fileIds;
}

/**
 *
 * @param connector {ChiliConnector}
 */
async function getDirectories(connector, apiKey, parentFolder) {
    const treeRes = await connector.resourceGetTreeLevelAsync(apiKey, "Documents", parentFolder, 1);

    const tree =  treeRes.tree.item;

    if (tree == null) {
        return {
            files: 0,
            folders: []
        }
    }

    let fileCount = 0;
    let folders = [];

    tree.forEach(item => {
       if (item.attr.isFolder === "true") {
            folders.push(item.attr.name);
       }
       else {
           fileCount++;
       }
    });

    return {
        files: fileCount,
        folders: folders
    }
}

async function chooseDirectory(connector, apiKey, parentDirectory) {

    if (parentDirectory == null) {
        parentDirectory = "/";
    }

    const directoryInfo = await getDirectories(connector, apiKey, parentDirectory);

    let choices = [new inquirer.Separator(), "***Process Current Directory***"];

    if (parentDirectory !== "/" && parentDirectory !== "./" && parentDirectory !== "") {
        choices.push("../");
    }

    choices.push(new inquirer.Separator(`Number of documents: ${directoryInfo.files}`));
    choices.push(new inquirer.Separator());

    choices = choices.concat(directoryInfo.folders);

    return (await inquirer.prompt([
        {
            type: "list",
            name: "folder",
            choices: choices,
            message: "Choose a folder or process the document"
        }
    ])).folder;

}

async function directoryCommandLine(currentDirectory, connector, apiKey) {

    const newDirectory = await chooseDirectory(connector, apiKey, currentDirectory.join("/"));

    if (newDirectory === "../" || newDirectory === "***Process Current Directory***") {
        if (newDirectory === "../") {
            currentDirectory.pop();
        }
        if (newDirectory === "***Process Current Directory***") {
            await getDirectoryPreviews(connector, apiKey, currentDirectory.join("/"));
        }
    }
    else {
        currentDirectory.push(newDirectory);
    }

    return currentDirectory;
}
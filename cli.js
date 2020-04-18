const fs = require("fs");
const axios = require("axios");
const node_ssh = require("node-ssh");

const loadConfigFile = (configFile) => {
  try {
    const config = require(configFile);
    return config;
  } catch (err) {
    console.log("unable to read the config file");
    process.exit(1);
  }
};

const getInterfaceInfo = (
  routerIP,
  routerUsername,
  sshPrivateKeyLocation,
  routerExternalInterfaceName
) => {
  return new Promise((resolve, reject) => {
    ssh = new node_ssh();
    ssh
      .connect({
        host: routerIP,
        username: routerUsername,
        privateKey: sshPrivateKeyLocation,
      })
      .then(() => {
        ssh
          .execCommand(`ip addr show dev ${routerExternalInterfaceName}`)
          .then((result) => {
            ssh.dispose();
            resolve(result.stdout);
          });
      });
  });
};

const parsePublicIP = (stdout) => {
  const regex = /inet (([0-9]*\.){3}[0-9]*) /gm;
  const result = regex.exec(stdout);
  return result[1].trim();
};

const getDomainRecords = (axiosInstance) => {
  return new Promise((resolve) => {
    axiosInstance.get("/records/").then((res) => {
      resolve(res.data);
    });
  });
};

const getMismatchedRecords = (currentPublicIP, domainRecords, hostnames) => {
  const hostRecords = hostnames.map((hostname) => {
    const { name, data, id, type } = domainRecords.find(({ name }) => {
      return name === hostname;
    });
    return { name, data, id, type };
  });

  const mismatchedRecords = hostRecords.filter(
    (record) => record.data !== currentPublicIP
  );

  return mismatchedRecords;
};

const fixRecords = async (
  mismatchedRecords,
  currentPublicIP,
  axiosInstance
) => {
  const correctedRecords = await Promise.all(
    mismatchedRecords.map((record) => {
      return new Promise((resolve, reject) => {
        axiosInstance
          .put(`records/${record.id}`, {
            type: record.type,
            name: record.name,
            data: currentPublicIP,
          })
          .then((res) => {
            resolve(res.data.domain_record);
          })
          .catch((error) => {
            console.log(error.response);
          });
      });
    })
  );

  return correctedRecords.every(({ data }) => {
    return data === currentPublicIP;
  });
};

const main = async () => {
  const configParameters = loadConfigFile("./config/config.json");

  const axiosInstance = axios.create({
    baseURL: `https://api.digitalocean.com/v2/domains/${configParameters.domainName}`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${configParameters.accessToken}`,
    },
  });

  const interfaceInfo = await getInterfaceInfo(
    configParameters.routerIP,
    configParameters.routerUsername,
    configParameters.sshPrivateKeyLocation,
    configParameters.routerExternalInterfaceName
  );
  const currentPublicIP = parsePublicIP(interfaceInfo);

  const domainRecords = await getDomainRecords(axiosInstance);
  const mismatchedRecords = getMismatchedRecords(
    currentPublicIP,
    domainRecords.domain_records,
    configParameters.hostnames
  );

  if (mismatchedRecords.length === 0) {
    console.log("All records good! Nothing to do.");
  } else {
    const fixRecordsResult = await fixRecords(
      mismatchedRecords,
      currentPublicIP,
      axiosInstance
    );
    if (fixRecordsResult) {
      console.log("All records fixed");
    } else {
      console.log("Unable to fix all the records");
    }
  }
};

main();

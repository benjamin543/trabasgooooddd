// Puente exclusivo del respaldo local. La versión de Pages usa PyScript.
window.pyApi = function(op, datos, fecha) {
  const req = new XMLHttpRequest();
  req.open('POST', '/api', false);
  req.setRequestHeader('Content-Type','application/json');
  req.send(JSON.stringify([op, datos, fecha]));
  if (req.status !== 200) throw Error('No se pudo consultar el motor Python local.');
  return req.responseText;
};
